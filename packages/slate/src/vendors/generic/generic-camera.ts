import type {
    CameraCapabilities,
    CameraControlId,
    CameraControlInputs,
    CameraControlState,
    OperationAvailability,
    UnrecognizedValues,
} from '@camera/controls'
import type {
    Battery,
    CameraEventHandler,
    CameraEventName,
    CameraInfo,
    CardStatus,
    ConfirmedPhotoFile,
    MediaDownloadOptions,
    MediaItem,
    MediaPreviewSize,
    PhotoDestination,
} from '@camera/driver'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext } from '@camera/exposure-time'
import type { Camera } from '@camera/index'
import type { CameraOperationName } from '@camera/driver'
import { validateProtocol, type ProtocolEvidence, type StatePhase } from '@contribute/protocol'
import { Logger } from '@core/logger'
import {
    PTPDecodeError,
    PTPDisconnectedError,
    PTPProtocolError,
    PTPRecoveryRequiredError,
    PTPResponseError,
    PTPTimeoutError,
    type PTPErrorContext,
} from '@core/ptp-errors'
import { slateTelemetry } from '@core/telemetry'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { recognizedDescriptorValues, type DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import { DeviceBusy, IncompleteTransfer, OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { randomSessionId } from '@ptp/definitions/session'
import { CONTAINER_TYPE, TransactionChannel, type TransactionPolicy } from '@ptp/transaction-channel'
import type { CodecDefinition, CodecInstance, CodecType } from '@ptp/types/codec'
import { EventDefinition, EventEmitter } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'
import type { MediaCapability } from '@vendors/generic/capability-groups'
import { OBJECT_SIZE_UNREPORTED, reportingRefusals } from '@vendors/generic/ptp-object-index'
import {
    afterShutterRelease,
    cardObjectFile,
    classified,
    shutterOutcomeUnknown,
    shutterRefused,
} from '@vendors/generic/shutter-outcome'
import { setStandardClock, standardClockUnavailable } from '@vendors/generic/standard-clock'
import {
    propertyWriteEvidence,
    protocolEvidence,
    stateSnapshotEvidence,
    type CachedDiagnosticSetting,
} from '@vendors/protocol-evidence'
import { createPTPRegistry, Registry } from '@vendors/registry'

/** ISO 15740 standard operation codes; their DeviceBusy answers mean "not performed, retry later". */
/** How long a camera takes to enumerate again after a USB port reset. */
const PORT_RESET_SETTLE_MS = 1500
/** A camera needs a moment after a Device Reset Request before it accepts OpenSession. */
const DEVICE_RESET_SETTLE_MS = 500

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

const STANDARD_OPERATIONS = { from: 0x1000, to: 0x1fff } as const

export interface StandardPropertyState {
    code: number
    codeHex: string
    name: string
    description: string
    value: number | bigint | string
    rawValue: number | bigint | string
    writable: boolean
    form: 'none' | 'range' | 'enum'
    allowedValues?: (number | bigint | string)[]
    minimumValue?: number | bigint | string
    maximumValue?: number | bigint | string
    stepSize?: number | bigint | string
    unrecognized?: UnrecognizedValues
}

export interface CameraRecoveryOptions {
    /** Upper bound for each transaction and reset during recovery. Default 8 s. */
    stepTimeoutMilliseconds?: number
    /** How long to wait for the camera to (re)appear on USB. Default 20 s. */
    waitForDeviceMilliseconds?: number
    /** Default true. Disable when recovery must preserve USB enumeration and other consumers. */
    allowPortReset?: boolean
}

export interface CameraRecoveryStep {
    step: 'enumerate' | 'session' | 'device-reset' | 'port-reset'
    ok: boolean
    durationMilliseconds: number
    detail?: string
}

export interface CameraRecoveryReport {
    /** The camera answered GetDeviceInfo after one of the steps. */
    recovered: boolean
    /** Software recovery could not bring the camera back: only now are power or hub cycling warranted. */
    needsPhysicalAction: boolean
    steps: CameraRecoveryStep[]
    durationMilliseconds: number
    identity?: { manufacturer: string; model: string; firmware: string }
}

interface RecoveryAttempt {
    task: Promise<void>
    status: 'pending' | 'succeeded' | 'failed'
    failure?: unknown
    /** The core USB reset rather than a caller-owned recoverTransport callback. */
    automatic: boolean
    /** The session open before the failure, reopened after an automatic reset. */
    previousSessionId: number | null
}

export class GenericCamera {
    protected emitter = new EventEmitter()
    public vendorId: number | null = null
    public sessionId: number | null = null
    private transactionId = 0
    private transactionQueue: Promise<void> = Promise.resolve()
    private needsResynchronization = false
    private lastFailure?: PTPErrorContext
    private recovery?: RecoveryAttempt
    private readonly channel: TransactionChannel
    private readonly telemetry: ReturnType<typeof slateTelemetry>
    private profileObserver?: { id: string; observe: (evidence: ProtocolEvidence) => void }
    private readonly responseObservers = new Set<(operationName: string, responseCode: number) => void>()
    private protocolSeen = new Map<string, string>()
    private diagnosticSettings = new Map<number, CachedDiagnosticSetting>()
    /** Synchronous, bounded and entirely cache-based. Diagnostic failures cannot change a camera workflow. */
    recordStateSnapshot(workflow: 'recording' | 'photo' | 'benchmark', phase: StatePhase) {
        try {
            this.recordProtocol(
                stateSnapshotEvidence(
                    this.vendorId ?? 0,
                    this.diagnosticSettings.values(),
                    workflow,
                    phase,
                    performance.now()
                )
            )
        } catch {
            /* Optional diagnostics must never interfere with capture or recovery. */
        }
    }
    /** A benchmark subscribes to this session's sanitized datasets, never to another connection. */
    observeProfile(id: string, observe: (evidence: ProtocolEvidence) => void) {
        if (this.profileObserver) throw new Error('A profile benchmark already owns this camera')
        this.profileObserver = { id, observe }
        return () => {
            if (this.profileObserver?.id === id) this.profileObserver = undefined
        }
    }
    /**
     * @internal Reports the operation name and response code of every transaction this session
     * completes while `work` runs, so a caller can tell a refused write from one the camera
     * acknowledged before a later step failed.
     */
    async observeResponses<T>(
        observe: (operationName: string, responseCode: number) => void,
        work: () => Promise<T>
    ): Promise<T> {
        this.responseObservers.add(observe)
        try {
            return await work()
        } finally {
            this.responseObservers.delete(observe)
        }
    }
    /** Validated, deduplicated and never thrown into the camera workflow that observed it. */
    recordProtocol(evidence: ProtocolEvidence, operation?: number) {
        try {
            this.shareProtocol(evidence, operation)
        } catch {
            /* Optional diagnostics must never interfere with a camera workflow. */
        }
    }
    private shareProtocol(evidence: ProtocolEvidence, operation?: number) {
        try {
            validateProtocol(evidence)
            if (
                (evidence.type === 'descriptor' || evidence.type === 'property-value') &&
                evidence.current !== undefined
            ) {
                if (this.diagnosticSettings.size >= 256 && !this.diagnosticSettings.has(evidence.property))
                    this.diagnosticSettings.clear()
                this.diagnosticSettings.set(evidence.property, {
                    property: evidence.property,
                    dataType: evidence.dataType,
                    current: evidence.current,
                    observedAt: performance.now(),
                })
            }
        } catch {
            return
        }
        const scoped = this.profileObserver ? { ...evidence, benchmarkId: this.profileObserver.id } : evidence
        if (scoped.type === 'property-write' || scoped.type === 'state-snapshot') {
            this.telemetry.protocol(scoped, operation)
            this.profileObserver?.observe(scoped)
            return
        }
        // Each distinct unrecognized raw value of a property is its own fact.
        const key = [
            scoped.benchmarkId ?? '',
            scoped.type,
            'property' in scoped ? scoped.property : 'category' in scoped ? scoped.category : '',
            'code' in scoped
                ? scoped.code
                : 'status' in scoped
                  ? scoped.status
                  : scoped.type === 'unrecognized-value'
                    ? `${scoped.raw}:${scoped.choice}`
                    : '',
        ].join(':')
        const encoded = JSON.stringify(scoped)
        if (this.protocolSeen.get(key) === encoded) return
        if (this.protocolSeen.size >= 8192) this.protocolSeen.clear()
        this.protocolSeen.set(key, encoded)
        // Every reconnect re-reads the same inventory and settings. Report a fact about an
        // identified body again only when it changes or after six hours, not once per connection.
        // The same key can carry different facts: a probe and a vendor session scope a code
        // differently, a setting's value and its allowed values arrive separately, and two
        // operations list the same inventory category. Remember each kind on its own so they
        // do not keep replacing one another and look new on every connection.
        const kind = `${key}:${'vendorId' in scoped ? scoped.vendorId : ''}:${operation ?? ''}:${Object.keys(scoped).sort().join(',')}`
        if (!scoped.benchmarkId && !this.telemetry.newFact(kind, encoded)) return
        this.telemetry.protocol(scoped, operation)
        this.profileObserver?.observe(scoped)
    }
    public transport: TransportInterface
    protected logger: Logger
    public registry: Registry

    protected liveViewBufferSize = 5 * 1024 * 1024 // 5MB
    protected captureBufferSize = 100 * 1024 * 1024 // 100MB
    protected bufferPadding = 1024 * 1024 // 1MB
    protected defaultChunkSize = 10 * 1024 * 1024 // 10MB

    constructor(transport: TransportInterface, logger: Logger) {
        this.telemetry = slateTelemetry(transport)
        transport = this.telemetry.transport
        this.transport = transport
        this.logger = logger
        this.channel = new TransactionChannel(transport, ({ container, reason }) =>
            this.logger.addLog({
                type: 'console',
                level: 'warn',
                consoleLevel: 'warn',
                args: [`Discarded PTP container 0x${container.code.toString(16).padStart(4, '0')}: ${reason}`],
            })
        )
        this.registry = createPTPRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)

        this.transport.on?.(event => this.handleEvent(event))
        // Record the public workflow outcome alongside its existing wire session.
        for (const [method, operation] of [
            ['sendStartRecording', 'record_start'],
            ['sendStopRecording', 'record_stop'],
        ] as const) {
            const work = this[method].bind(this)
            this[method] = () =>
                this.telemetry.operation(operation, async () => {
                    this.recordStateSnapshot(
                        'recording',
                        method === 'sendStartRecording' ? 'before-start' : 'before-stop'
                    )
                    try {
                        await work()
                        this.recordStateSnapshot(
                            'recording',
                            method === 'sendStartRecording' ? 'after-start' : 'after-stop'
                        )
                    } catch (error) {
                        this.recordStateSnapshot('recording', 'failure')
                        throw error
                    }
                })
        }
    }

    /** @internal The façade uses this same lifecycle before selecting the opened USB body's driver. */
    async connectTransport(device?: DeviceDescriptor): Promise<void> {
        await this.telemetry.prepare()
        if (this.recovery?.status === 'pending')
            throw new PTPRecoveryRequiredError('Transport recovery is still running', this.lastFailure)
        if (!this.transport.isConnected()) {
            await this.transport.connect(device)
            // The transport drops its event handler on disconnect; subscribe again for this connection.
            this.transport.on?.(event => this.handleEvent(event))
            this.channel.newConnection()
            this.protocolSeen.clear()
            this.diagnosticSettings.clear()
            this.needsResynchronization = false
            this.lastFailure = undefined
            this.recovery = undefined
        } else await this.resynchronizeIfNeeded()
    }

    /** @internal Release a discarded driver's instrumentation without closing the selected transport. */
    detachTransportObserver(): void {
        this.telemetry.detach()
        this.emitter.removeAllListeners()
    }

    /**
     * Opens the transport and a session. A camera left mid-transfer by a host that crashed never
     * answers OpenSession; then the USB port is reset, as a replug would, and the open retried once.
     */
    async connect(device?: DeviceDescriptor): Promise<void> {
        await this.connectTransport(device)
        try {
            await this.openFreshSession()
        } catch (error) {
            const unanswered = error instanceof PTPTimeoutError || error instanceof PTPRecoveryRequiredError
            if (!unanswered || !this.channel.policy.automaticUSBReset || !this.transport.resetPort) throw error
            await this.recovery?.task.catch(() => undefined)
            await this.transport.resetPort()
            this.recovery = undefined
            this.lastFailure = undefined
            this.needsResynchronization = false
            await delay(PORT_RESET_SETTLE_MS)
            await this.connectTransport(device)
            await this.openFreshSession()
        }
    }

    protected createSessionId(): number {
        return randomSessionId()
    }

    /** @internal Vendor admission may preserve an observed active session after transport loss. */
    protected async existingRecordingSession(_previousSessionId: number | null): Promise<number | undefined> {
        return undefined
    }

    private async openFreshSession(): Promise<void> {
        const previousSessionId = this.sessionId
        this.sessionId = this.createSessionId()
        try {
            let openResult = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
            if (openResult.code === SessionAlreadyOpen.code) {
                const existing = await this.existingRecordingSession(previousSessionId)
                if (existing !== undefined) {
                    this.sessionId = existing
                    return
                }
                const closed = await this.send(this.registry.operations.CloseSession, {})
                if (closed.code !== OK.code)
                    throw new PTPResponseError(closed.code, `CloseSession failed: 0x${closed.code.toString(16)}`)
                openResult = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
            }
            if (openResult.code !== OK.code)
                throw new PTPResponseError(openResult.code, `OpenSession failed: 0x${openResult.code.toString(16)}`)
        } catch (error) {
            this.sessionId = null
            throw error
        }
    }

    /**
     * Closes the session and the transport. Safe to call more than once and after the camera has
     * vanished: the transport still releases its handles, and cleanup failures are reported together.
     */
    async disconnect(): Promise<void> {
        if (this.recovery?.status === 'pending')
            throw new PTPRecoveryRequiredError(
                'Transport recovery is still running; disconnect must wait',
                this.lastFailure
            )
        this.emitter.removeAllListeners()
        try {
            await this.closeSessionAndTransport()
        } finally {
            this.diagnosticSettings.clear()
        }
    }

    /**
     * Closes and reopens the PTP session on the same device, keeping the caller's event
     * subscriptions. For bodies that only leave a state (such as Sony playback) on a new session.
     */
    async reopenSession(device?: DeviceDescriptor): Promise<void> {
        await this.closeSessionAndTransport()
        await this.connect(device)
    }

    /**
     * Brings back a camera that has stopped answering, using only software: no power or hub
     * cycling. Each step is tried only if the one before it failed, and each verifies a fresh
     * camera identity and the vendor's advertised readiness check before claiming recovery:
     *
     * 1. session: open a fresh session (a camera that is merely idle or left with a stale session).
     * 2. device-reset: the still-image class Device Reset Request, a wait for abandoned I/O to
     *    settle, then a fresh session (a camera left mid-transaction by a host that died).
     * 3. port-reset: a libusb port reset, the software equivalent of a replug, then a wait for the
     *    camera to enumerate again and a fresh session.
     *
     * A camera that is not on USB at all is waited for, up to `waitForDeviceMilliseconds`, since it
     * may still be starting. Whatever the outcome the transport is left closed, so the caller
     * connects normally afterwards (vendor setup belongs to connect). When no step works,
     * `needsPhysicalAction` is true: only then are power or hub cycling warranted.
     */
    async recover(device?: DeviceDescriptor, options: CameraRecoveryOptions = {}): Promise<CameraRecoveryReport> {
        const stepTimeout = options.stepTimeoutMilliseconds ?? 8_000
        const waitForDevice = options.waitForDeviceMilliseconds ?? 20_000
        const previousPolicy = { ...this.channel.policy }
        // Recovery chooses its own steps: no automatic reset or busy retries may run underneath it.
        this.channel.configure({
            timeoutMilliseconds: stepTimeout,
            automaticUSBReset: false,
            deviceBusyRetries: 2,
            recoverTransport: undefined,
        })
        const steps: CameraRecoveryStep[] = []
        const started = Date.now()
        const attempt = async (step: CameraRecoveryStep['step'], work: () => Promise<void>) => {
            const begun = Date.now()
            try {
                await work()
                const identity = await this.readIdentityForRecovery()
                steps.push({ step, ok: true, durationMilliseconds: Date.now() - begun })
                return identity
            } catch (error) {
                steps.push({
                    step,
                    ok: false,
                    durationMilliseconds: Date.now() - begun,
                    detail: error instanceof Error ? error.message : String(error),
                })
                return undefined
            }
        }
        try {
            const present = await this.waitForTransport(device, waitForDevice)
            if (!present.ok) {
                steps.push({
                    step: 'enumerate',
                    ok: false,
                    durationMilliseconds: Date.now() - started,
                    detail: present.detail,
                })
                return {
                    recovered: false,
                    needsPhysicalAction: true,
                    steps,
                    durationMilliseconds: Date.now() - started,
                }
            }
            let identity = await attempt('session', () => this.openFreshSession())
            if (!identity)
                identity = await attempt('device-reset', async () => {
                    if (!this.transport.isConnected()) await this.connectTransport(device)
                    await this.withStepTimeout(
                        this.transport.classRequestReset(),
                        stepTimeout,
                        'the Device Reset Request'
                    )
                    if (!(await this.channel.settle(stepTimeout)))
                        throw new Error('abandoned USB I/O did not settle after the Device Reset Request')
                    this.clearRecoveryState()
                    await delay(DEVICE_RESET_SETTLE_MS)
                    await this.openFreshSession()
                })
            if (!identity && options.allowPortReset !== false && this.transport.resetPort)
                identity = await attempt('port-reset', async () => {
                    if (!this.transport.isConnected()) await this.connectTransport(device)
                    await this.withStepTimeout(this.transport.resetPort!(), stepTimeout, 'the USB port reset')
                    this.sessionId = null
                    this.clearRecoveryState()
                    await delay(PORT_RESET_SETTLE_MS)
                    const back = await this.waitForTransport(device, waitForDevice)
                    if (!back.ok)
                        throw new Error(`the camera did not enumerate again after the port reset: ${back.detail}`)
                    await this.openFreshSession()
                })
            return {
                recovered: !!identity,
                needsPhysicalAction: !identity,
                steps,
                durationMilliseconds: Date.now() - started,
                ...(identity && { identity }),
            }
        } finally {
            this.channel.configure(previousPolicy)
            await this.closeSessionAndTransport().catch(() => undefined)
            this.clearRecoveryState()
        }
    }

    private async readIdentityForRecovery(): Promise<CameraRecoveryReport['identity']> {
        const response = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (response.code !== OK.code || !response.data)
            throw new PTPResponseError(response.code, `GetDeviceInfo returned 0x${response.code.toString(16)}`, {
                operation: 'GetDeviceInfo',
            })
        await this.verifyRecoveryState(response.data)
        const info = response.data as { manufacturer?: string; model?: string; deviceVersion?: string }
        return {
            manufacturer: String(info.manufacturer ?? ''),
            model: String(info.model ?? ''),
            firmware: String(info.deviceVersion ?? ''),
        }
    }

    /** Vendors may still reject controls while their identity remains readable. */
    protected async verifyRecoveryState(_information: DeviceInfo): Promise<void> {}

    /** Opens the transport, retrying until the camera is on the bus or the wait runs out. */
    private async waitForTransport(
        device: DeviceDescriptor | undefined,
        milliseconds: number
    ): Promise<{ ok: true } | { ok: false; detail: string }> {
        const deadline = Date.now() + milliseconds
        let last = 'the camera is not on USB'
        for (;;) {
            try {
                if (!this.transport.isConnected()) await this.connectTransport(device)
                return { ok: true }
            } catch (error) {
                last = error instanceof Error ? error.message : String(error)
            }
            if (Date.now() >= deadline) return { ok: false, detail: last }
            await delay(500)
        }
    }

    private async withStepTimeout<T>(work: Promise<T>, milliseconds: number, what: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            return await Promise.race([
                work,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`${what} did not complete within ${milliseconds} ms`)),
                        milliseconds
                    )
                }),
            ])
        } finally {
            clearTimeout(timer)
        }
    }

    private clearRecoveryState(): void {
        this.needsResynchronization = false
        this.lastFailure = undefined
        this.recovery = undefined
    }

    protected async closeSessionAndTransport(): Promise<void> {
        const failures: unknown[] = []
        try {
            // A tainted pipe gets no CloseSession; the transport is still released below.
            if (this.sessionId !== null && this.transport.isConnected() && !this.needsResynchronization) {
                const response = await this.send(this.registry.operations.CloseSession, {})
                if (response.code !== OK.code)
                    throw new PTPResponseError(response.code, `CloseSession returned 0x${response.code.toString(16)}`)
            }
        } catch (error) {
            failures.push(error)
        }
        this.sessionId = null
        try {
            // Also after an unplug: the transport releases its handles even when no longer connected.
            await this.transport.disconnect()
        } catch (error) {
            failures.push(error)
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'Camera disconnect cleanup failed')
    }

    /** Tunes timeouts, retry bounds and timeout recovery (automatic USB reset or a callback) for later transactions. */
    configureTransactions(policy: Partial<TransactionPolicy>): void {
        this.channel.configure(policy)
        if ('recoverTransport' in policy && this.recovery?.status === 'failed') this.recovery = undefined
    }

    /**
     * PTP is strictly request/response over a single pair of bulk endpoints, so only one
     * transaction may be in flight at a time. Vendor subclasses poll for events on a timer, and
     * setInterval does not wait for its async callback, so polls can overlap each other and any
     * caller-initiated operation. Overlapping transactions interleave on the shared endpoints and
     * abort libusb. Queueing every transaction here keeps the bus serialized.
     *
     * Every phase is bounded by the transaction policy's timeout, replies are checked against
     * ISO 15740 container framing, and failures are typed (`PTPTimeoutError`, `PTPProtocolError`,
     * `PTPDecodeError`, `PTPDisconnectedError`). A non-OK response code is returned, not thrown.
     */
    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const result = this.transactionQueue.then(
            () => this.sendTransaction(operation, params, data, maxDataLength),
            () => this.sendTransaction(operation, params, data, maxDataLength)
        )

        // Keep the chain alive after a rejection so one failed transaction cannot wedge the queue.
        this.transactionQueue = result.then(
            () => undefined,
            () => undefined
        )

        const response = await result
        for (const observe of this.responseObservers) observe(operation.name, response.code)
        if (operation.code === 0x1001 && response.code === OK.code && 'data' in response && response.data) {
            await this.telemetry.identify(
                response.data as unknown as {
                    manufacturer: string
                    model: string
                    deviceVersion: string
                    serialNumber?: string
                }
            )
        }
        if (response.code === OK.code && 'data' in response && response.data) {
            try {
                for (const evidence of protocolEvidence(
                    this.vendorId ?? 0,
                    this.registry,
                    operation.code,
                    response.data
                ))
                    this.recordProtocol(evidence, operation.code)
            } catch {
                /* A diagnostics failure must not turn a completed camera read into a failure. */
            }
        }
        return response
    }

    private async sendTransaction<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        // Everything that can fail locally fails before a transaction ID is spent or a byte is sent,
        // so a strict camera never sees a gap in transaction IDs or a command without its data phase.
        if (!this.transport.isConnected()) {
            throw new PTPDisconnectedError('the camera is not connected', { operation: operation.name })
        }
        if (operation.dataDirection === 'in' && !data) throw new Error('Data required for dataDirection=in')
        if (maxDataLength !== undefined && (!Number.isSafeInteger(maxDataLength) || maxDataLength < 12))
            throw new Error('Data buffer length must include the 12-byte PTP header')
        const paramsRecord: Record<string, number | bigint | string> = params
        const encodedParams = this.encodeParameters(operation, paramsRecord)
        await this.resynchronizeIfNeeded()

        const retriesDeviceBusy = operation.code >= STANDARD_OPERATIONS.from && operation.code <= STANDARD_OPERATIONS.to
        const startedAt = Date.now()
        for (let attempt = 0; ; attempt++) {
            const response = await this.runTransaction(operation, paramsRecord, encodedParams, data, maxDataLength)
            if (response.code !== DeviceBusy.code || !retriesDeviceBusy) return response
            const delayMilliseconds = this.channel.deviceBusyDelay(attempt, Date.now() - startedAt)
            if (delayMilliseconds === undefined) return response
            await this.waitMs(delayMilliseconds)
        }
    }

    private encodeParameters(
        operation: OperationDefinition,
        paramsRecord: Record<string, number | bigint | string>
    ): Uint8Array[] {
        const encodedParams: Uint8Array[] = []
        for (const paramDef of operation.operationParameters) {
            if (!paramDef) continue

            let value = paramsRecord[paramDef.name]

            if (value === undefined && 'defaultValue' in paramDef && paramDef.defaultValue !== undefined) {
                value = paramDef.defaultValue
            }

            if (value === undefined && !paramDef.required) continue

            if (value === undefined && paramDef.required) {
                throw new Error(`Required parameter ${paramDef.name} missing`)
            }

            const codec = this.resolveCodec(paramDef.codec)
            const encoded = codec.encode(value)
            if (encoded.length > 4) throw new Error(`Parameter ${paramDef.name} exceeds a UINT32 slot`)
            encodedParams.push(encoded)
        }
        if (encodedParams.length > 5) throw new Error('PTP commands accept at most five parameters')
        return encodedParams
    }

    /**
     * An abandoned or malformed transfer is unsafe to reuse. Before the next command, a caller-owned
     * TransactionPolicy.recoverTransport runs if one is configured. Otherwise, over USB, core resets
     * automatically: the still-image class Device Reset Request (libgphoto2 sends the same request
     * after an I/O error or timeout), a bounded wait for the abandoned I/O to settle, and a fresh
     * OpenSession if a session was open. Only when that recovery fails, or the transport has no
     * class reset (PTP/IP), do commands fail with PTPRecoveryRequiredError until a disconnect/connect.
     * Timing out a recovery wait does not cancel it or permit another command to race it.
     */
    private async resynchronizeIfNeeded(): Promise<void> {
        if (!this.needsResynchronization) return
        if (!this.recovery) {
            const recover = this.channel.policy.recoverTransport
            const automatic =
                !recover && this.channel.policy.automaticUSBReset && this.transport.getType() === TransportType.USB
            if (!recover && !automatic)
                throw new PTPRecoveryRequiredError(
                    'Transport recovery is required; this transport has no automatic reset and no recovery callback is configured',
                    this.lastFailure
                )
            const previousSessionId = this.sessionId
            this.sessionId = null
            const failure = this.lastFailure ?? {}
            const task = Promise.resolve().then(() => (recover ? recover(failure) : this.resetUSBTransport()))
            const attempt: RecoveryAttempt = { task, status: 'pending', automatic, previousSessionId }
            this.recovery = attempt
            void task.then(
                () => {
                    attempt.status = 'succeeded'
                },
                error => {
                    attempt.status = 'failed'
                    attempt.failure = error
                }
            )
        }
        const attempt = this.recovery
        // The automatic reset bounds each of its own steps; a caller-owned callback gets one timeout.
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                attempt.task.catch(() => undefined),
                ...(attempt.automatic
                    ? []
                    : [
                          new Promise<void>(resolve => {
                              timer = setTimeout(resolve, this.channel.policy.timeoutMilliseconds)
                          }),
                      ]),
            ])
        } finally {
            clearTimeout(timer)
        }
        if (attempt.status === 'pending')
            throw new PTPRecoveryRequiredError(
                'Transport recovery is still running; no further command was sent',
                this.lastFailure
            )
        if (attempt.status === 'failed')
            throw new PTPRecoveryRequiredError(
                `${attempt.automatic ? 'Automatic USB reset' : 'Transport recovery'} failed: ${attempt.failure instanceof Error ? attempt.failure.message : String(attempt.failure)}`,
                { ...this.lastFailure, cause: attempt.failure }
            )
        if (this.channel.hasPendingIO)
            throw new PTPRecoveryRequiredError(
                'Recovery returned while abandoned transport I/O is still running',
                this.lastFailure
            )
        const failure = this.lastFailure
        this.recovery = undefined
        this.lastFailure = undefined
        this.needsResynchronization = false
        if (!attempt.automatic || attempt.previousSessionId === null) return
        try {
            await this.reopenSessionAfterReset(attempt.previousSessionId)
        } catch (error) {
            // The camera did not come back after the reset: latch until disconnect/connect.
            this.sessionId = null
            this.needsResynchronization = true
            this.lastFailure = failure
            this.recovery = {
                task: Promise.resolve(),
                status: 'failed',
                failure: error,
                automatic: true,
                previousSessionId: null,
            }
            throw new PTPRecoveryRequiredError(
                `Automatic USB reset failed to reopen the session: ${error instanceof Error ? error.message : String(error)}`,
                { ...failure, cause: error }
            )
        }
    }

    /** Device Reset Request, then a bounded wait until the abandoned reads and writes have settled. */
    private async resetUSBTransport(): Promise<void> {
        const timeout = this.channel.policy.timeoutMilliseconds
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            await Promise.race([
                this.transport.classRequestReset(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`the Device Reset Request did not complete within ${timeout} ms`)),
                        timeout
                    )
                }),
            ])
        } finally {
            clearTimeout(timer)
        }
        if (!(await this.channel.settle(timeout)))
            throw new Error('abandoned USB I/O did not settle after the Device Reset Request')
    }

    /** A Device Reset may or may not end the session; reopen it, keeping one the camera still holds. */
    private async reopenSessionAfterReset(previousSessionId: number): Promise<void> {
        const openSession = this.registry.operations.OpenSession
        const sessionId = this.createSessionId()
        this.sessionId = sessionId
        const params = { SessionID: sessionId }
        const response = await this.runTransaction(openSession, params, this.encodeParameters(openSession, params))
        if (response.code === OK.code) return
        if (response.code === SessionAlreadyOpen.code) {
            this.sessionId = previousSessionId
            return
        }
        throw new PTPResponseError(response.code, `OpenSession returned 0x${response.code.toString(16)}`, {
            operation: 'OpenSession',
        })
    }

    private decodeWith<T>(
        codec: CodecDefinition<T> | CodecDefinition<any>,
        bytes: Uint8Array,
        context: { operation: string; transactionId: number; what: string }
    ): T {
        try {
            return this.resolveCodec<T>(codec).decode(bytes).value
        } catch (error) {
            throw new PTPDecodeError(
                `could not decode ${context.what} (${bytes.length} bytes): ${error instanceof Error ? error.message : String(error)}`,
                { operation: context.operation, transactionId: context.transactionId, cause: error }
            )
        }
    }

    private decodeDataPhase(
        operation: OperationDefinition,
        paramsRecord: Record<string, number | bigint | string>,
        receivedData: Uint8Array,
        decodeContext: (what: string) => { operation: string; transactionId: number; what: string }
    ): number | bigint | string | object | Uint8Array | undefined {
        if (receivedData.length === 0) return undefined
        if ('dataCodec' in operation && operation.dataCodec) {
            const decoded = this.decodeWith(operation.dataCodec, receivedData, decodeContext('the data phase'))
            if (decoded) return decoded as number | bigint | string | object
        }
        const propCode = paramsRecord.DevicePropCode
        if (!operation.name.includes('GetDevicePropValue') || propCode === undefined) return undefined
        const property = Object.values(this.registry.properties).find((p: any) => p.code === propCode)
        if (!property) return undefined
        return {
            propertyName: property.name,
            propertyCode: propCode,
            value: this.decodeWith(property.codec, receivedData, decodeContext(property.name)),
        }
    }

    private async runTransaction<Op extends OperationDefinition>(
        operation: Op,
        paramsRecord: Record<string, number | bigint | string>,
        encodedParams: Uint8Array[],
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        // Checked again here: the transport can vanish while a DeviceBusy retry waits.
        if (!this.transport.isConnected()) {
            throw new PTPDisconnectedError('the camera is not connected', { operation: operation.name })
        }
        const transactionId = this.getNextTransactionId()
        const sessionId = this.sessionId ?? 0
        try {
            const response = await this.exchange(
                operation,
                paramsRecord,
                encodedParams,
                transactionId,
                sessionId,
                data,
                maxDataLength
            )
            this.recordPropertyWrite(operation.code, data, transactionId, response.code)
            return response
        } catch (error) {
            this.recordPropertyWrite(operation.code, data, transactionId)
            if (error instanceof PTPTimeoutError || error instanceof PTPProtocolError) {
                this.needsResynchronization = true
                this.lastFailure = { operation: operation.name, transactionId, cause: error }
            }
            // Transport errors keep their own type; a transport that went away also ended the session.
            if (!this.transport.isConnected()) this.sessionId = null
            throw error
        }
    }

    private recordPropertyWrite(
        operation: number,
        data: Uint8Array | undefined,
        transactionId: number,
        response?: number
    ) {
        try {
            const evidence = propertyWriteEvidence(this.vendorId ?? 0, operation, data, transactionId, response)
            if (evidence) this.recordProtocol(evidence, operation)
        } catch {
            /* Optional diagnostics cannot change the result of a camera transaction. */
        }
    }

    private async exchange<Op extends OperationDefinition>(
        operation: Op,
        paramsRecord: Record<string, number | bigint | string>,
        encodedParams: Uint8Array[],
        transactionId: number,
        sessionId: number,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const decodeContext = (what: string) => ({ operation: operation.name, transactionId, what })

        // Check if this is part of an active transfer (managed externally via logger.startTransfer)
        const objectHandleValue = paramsRecord.ObjectHandle
        const objectHandle: number | null = typeof objectHandleValue === 'number' ? objectHandleValue : null
        const existingTransferLogId = objectHandle !== null ? this.logger.getActiveTransfer(objectHandle) : undefined

        let logId: number
        if (existingTransferLogId !== undefined) {
            // This operation is part of an active transfer, don't create a new log
            logId = existingTransferLogId
        } else {
            const shouldLog = operation.name !== 'CanonGetEventData'

            if (shouldLog) {
                logId = this.logger.addLog({
                    type: 'ptp_operation',
                    level: 'info',
                    sessionId,
                    transactionId,
                    requestPhase: {
                        timestamp: Date.now(),
                        operationName: operation.name,
                        encodedParams,
                        decodedParams: paramsRecord,
                    },
                })
            } else {
                logId = -1
            }
        }

        const commandContainer = this.buildCommand(operation.code, transactionId, encodedParams)
        await this.channel.send(commandContainer, sessionId, { operation: operation.name, transactionId })

        let receivedData: Uint8Array | undefined
        let undecodableData: unknown
        if (operation.dataDirection === 'in' && data) {
            const dataContainer = this.buildData(operation.code, transactionId, data)

            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if (data.length > 0 && 'dataCodec' in operation && operation.dataCodec) {
                try {
                    decodedData = this.resolveCodec(operation.dataCodec).decode(data).value
                } catch {
                    // Logging the outgoing payload must never prevent the transaction.
                }
            }

            // Decode property values for SetDevicePropValue operations
            if (
                data.length > 0 &&
                !decodedData &&
                (operation.name.includes('SetDevicePropValue') || operation.name.includes('ControlDevice'))
            ) {
                const propCode =
                    paramsRecord.DevicePropCode !== undefined
                        ? paramsRecord.DevicePropCode
                        : paramsRecord.sdiControlCode !== undefined
                          ? paramsRecord.sdiControlCode
                          : undefined

                if (propCode !== undefined) {
                    const property = Object.values(this.registry.properties).find((p: any) => p.code === propCode)
                    if (property) {
                        try {
                            const codec = this.resolveCodec(property.codec)
                            const result = codec.decode(data)
                            decodedData = {
                                propertyName: property.name,
                                propertyCode: propCode,
                                value: result.value,
                            }
                        } catch {
                            // Sony SDIO_ControlDevice uses a small signed direction
                            // payload for otherwise UINT16/UINT32 properties. Logging
                            // must never prevent the correctly encoded transaction.
                            decodedData = {
                                propertyName: property.name,
                                propertyCode: propCode,
                                controlPayload: [...data],
                            }
                        }
                    }
                }
            }

            if (logId !== -1) {
                this.logger.updateLog(logId, {
                    dataPhase: {
                        timestamp: Date.now(),
                        direction: 'in',
                        bytes: data.length,
                        encodedData: data,
                        decodedData,
                        maxDataLength,
                    },
                })
            }

            await this.channel.send(dataContainer, sessionId, { operation: operation.name, transactionId })
        } else if (operation.dataDirection === 'out') {
            const bufferSize = maxDataLength || 256 * 1024
            const dataContainer = await this.channel.receive(sessionId, {
                operation: operation.name,
                operationCode: operation.code,
                dataOperationCode: operation.dataOperationCode,
                transactionId,
                phase: 'data',
                maxLength: bufferSize,
            })
            receivedData = dataContainer.payload

            // If we received a response container instead of data, treat it as the response
            if (dataContainer.type === CONTAINER_TYPE.response) {
                const responseCode = dataContainer.code

                // Update logger with response phase before returning
                if (logId !== -1) {
                    this.logger.updateLog(logId, {
                        responsePhase: {
                            timestamp: Date.now(),
                            code: responseCode,
                        },
                    })
                }

                return {
                    code: responseCode,
                    parameters: this.decodeResponseParameters(dataContainer.payload),
                    data: receivedData && receivedData.length > 0 ? receivedData : undefined,
                } as OperationResponse<Op>
            }

            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            try {
                decodedData = this.decodeDataPhase(operation, paramsRecord, receivedData, decodeContext)
            } catch (error) {
                // Read the response first so the camera's pipe is clean for the next transaction.
                undecodableData = error
            }

            if (logId !== -1) {
                const currentLog = this.logger.getLogById(logId)
                if (!currentLog || currentLog.type !== 'ptp_transfer') {
                    this.logger.updateLog(logId, {
                        dataPhase: {
                            timestamp: Date.now(),
                            direction: 'out',
                            bytes: receivedData?.length || 0,
                            encodedData: receivedData,
                            decodedData: decodedData,
                            maxDataLength,
                        },
                    })
                }
            }
        }

        const responseContainer = await this.channel.receive(sessionId, {
            operation: operation.name,
            operationCode: operation.code,
            transactionId,
            phase: 'response',
            maxLength: 512,
        })

        if (undecodableData !== undefined) {
            if (responseContainer.code === OK.code) throw undecodableData
            return {
                code: responseContainer.code,
                parameters: this.decodeResponseParameters(responseContainer.payload),
                data: receivedData,
            } as OperationResponse<Op>
        }

        const currentLog = logId !== -1 ? this.logger.getLogById(logId) : undefined
        const isTransferLog = currentLog && currentLog.type === 'ptp_transfer'

        // If data phase had empty payload but response has payload, use response payload as data
        if (
            operation.dataDirection === 'out' &&
            (!receivedData || receivedData.length === 0) &&
            responseContainer.payload.length > 0
        ) {
            receivedData = responseContainer.payload

            // Decode the response payload if we have a dataCodec
            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if ('dataCodec' in operation && operation.dataCodec) {
                decodedData = this.decodeWith(operation.dataCodec, receivedData, decodeContext('the response payload'))
            }

            if (logId !== -1) {
                this.logger.updateLog(logId, {
                    dataPhase: {
                        timestamp: Date.now(),
                        direction: 'out',
                        bytes: receivedData.length,
                        encodedData: receivedData,
                        decodedData,
                        maxDataLength,
                    },
                })
            }
        }

        if (logId !== -1 && !isTransferLog) {
            this.logger.updateLog(logId, {
                responsePhase: {
                    timestamp: Date.now(),
                    code: responseContainer.code,
                },
            })
        }

        const isPropertyOp = operation.name.includes('GetDevicePropValue')
        const finalData = logId !== -1 ? this.logger.getLogById(logId) : undefined
        let returnData: any =
            !isPropertyOp &&
            finalData &&
            finalData.type === 'ptp_operation' &&
            finalData.dataPhase?.decodedData !== undefined
                ? finalData.dataPhase.decodedData
                : receivedData

        // If logId is -1 (operation wasn't logged), still decode if dataCodec exists
        if (
            logId === -1 &&
            receivedData &&
            receivedData.length > 0 &&
            'dataCodec' in operation &&
            operation.dataCodec
        ) {
            returnData = this.decodeWith(operation.dataCodec, receivedData, decodeContext('the data phase'))
        }

        return {
            code: responseContainer.code,
            parameters:
                responseContainer.type === 3 ? this.decodeResponseParameters(responseContainer.payload) : undefined,
            data: returnData,
        } as OperationResponse<Op>
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new CameraUnsupportedError(property.name, `Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.GetDevicePropDesc, {
            DevicePropCode: property.code,
        })

        if (!('data' in response) || !response.data) {
            throw new PTPDecodeError(`GetDevicePropDesc returned no descriptor for ${property.name}`)
        }

        // DevicePropDesc uses the registered property codec for the decoded current value.
        return response.data.currentValueDecoded as CodecType<P['codec']>
    }

    /** Read a standalone value with its registered codec, without requesting a property descriptor. */
    async readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new CameraUnsupportedError(property.name, `Property ${property.name} is not readable`)
        }
        const operation = this.registry.operations.GetDevicePropValue
        const response = await this.send(operation, { DevicePropCode: property.code })
        if (response.code !== OK.code) {
            throw new PTPResponseError(response.code, undefined, { operation: operation.name })
        }
        try {
            if (!(response.data instanceof Uint8Array) || response.data.length === 0) {
                throw new Error('No property value received')
            }
            const decoded = this.resolveCodec(property.codec).decode(response.data)
            if (decoded.bytesRead !== response.data.length) {
                throw new Error(`Decoded ${decoded.bytesRead} of ${response.data.length} bytes`)
            }
            return decoded.value as CodecType<P['codec']>
        } catch (error) {
            throw new PTPDecodeError(
                `could not decode ${property.name}: ${error instanceof Error ? error.message : String(error)}`,
                { operation: operation.name, cause: error }
            )
        }
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new CameraUnsupportedError(property.name, `Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            encodedValue
        )
        if (response.code !== OK.code)
            throw new PTPResponseError(response.code, undefined, { operation: 'SetDevicePropValue' })
    }

    async getStandardPropertyStates(propertyNameOrCode?: string | number): Promise<StandardPropertyState[]> {
        const deviceInfoResponse = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (deviceInfoResponse.code !== OK.code) {
            throw new PTPResponseError(deviceInfoResponse.code, undefined, { operation: 'GetDeviceInfo' })
        }
        if (!deviceInfoResponse.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')

        const deviceInfo = deviceInfoResponse.data
        const states: StandardPropertyState[] = []
        for (const code of deviceInfo.devicePropertiesSupported) {
            const property = Object.values(this.registry.properties).find(candidate => candidate.code === code)
            if (!property) continue
            if (
                propertyNameOrCode !== undefined &&
                (typeof propertyNameOrCode === 'number'
                    ? code !== propertyNameOrCode
                    : property.name.toLowerCase() !== propertyNameOrCode.toLowerCase() &&
                      `0x${code.toString(16).padStart(4, '0')}` !== propertyNameOrCode.toLowerCase())
            )
                continue

            try {
                const response = await this.send(this.registry.operations.GetDevicePropDesc, { DevicePropCode: code })
                if (!response.data) continue
                states.push(this.standardPropertyState(response.data))
            } catch (error) {
                if (
                    error instanceof PTPTimeoutError ||
                    error instanceof PTPDisconnectedError ||
                    error instanceof PTPProtocolError ||
                    error instanceof PTPRecoveryRequiredError
                )
                    throw error
                if (error instanceof PTPDecodeError)
                    this.recordProtocol({
                        type: 'unknown',
                        vendorId: this.vendorId ?? 0,
                        category: 'property',
                        code,
                        advertised: true,
                    })
                this.logger.addLog({
                    type: 'console',
                    level: 'warn',
                    consoleLevel: 'warn',
                    args: [
                        `Could not decode advertised property 0x${code.toString(16).padStart(4, '0')}`,
                        error instanceof Error ? error.message : String(error),
                    ],
                })
            }
        }
        return states
    }

    async setStandardProperty(propertyNameOrCode: string | number, requestedValue: string | number): Promise<void> {
        const states = await this.getStandardPropertyStates(propertyNameOrCode)
        const requestedName = String(propertyNameOrCode).toLowerCase()
        const state = states.find(candidate =>
            typeof propertyNameOrCode === 'number'
                ? candidate.code === propertyNameOrCode
                : candidate.name.toLowerCase() === requestedName || candidate.codeHex.toLowerCase() === requestedName
        )
        if (!state)
            throw new CameraUnsupportedError(String(propertyNameOrCode), `The attached camera does not advertise ${propertyNameOrCode}`)
        if (!state.writable) throw new CameraUnsupportedError(state.name, `${state.name} is read-only on the attached camera`)

        const property = Object.values(this.registry.properties).find(candidate => candidate.code === state.code)
        if (!property)
            throw new CameraUnsupportedError(state.name, `${state.codeHex} has no standard PTP property definition`)

        let value: number | bigint | string = requestedValue
        if (state.allowedValues?.length) {
            const matched = state.allowedValues.find(candidate => String(candidate) === String(requestedValue))
            if (matched === undefined) {
                throw new CameraRefusedError(
                    state.name,
                    `${requestedValue} is not advertised for ${state.name}; choose ${state.allowedValues.map(String).join(', ')}`
                )
            }
            value = matched
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)
        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            encodedValue
        )
        if (response.code !== OK.code) {
            throw new PTPResponseError(
                response.code,
                `SetDevicePropValue for ${state.name} returned 0x${response.code.toString(16)}`
            )
        }
    }

    private standardPropertyState(descriptor: DevicePropDesc): StandardPropertyState {
        const { allowedValues, unrecognized } = recognizedDescriptorValues(descriptor)
        return {
            code: descriptor.devicePropertyCode,
            codeHex: `0x${descriptor.devicePropertyCode.toString(16).padStart(4, '0')}`,
            name: descriptor.devicePropertyName,
            description: descriptor.devicePropertyDescription,
            value: descriptor.currentValueDecoded,
            rawValue: descriptor.currentValueRaw,
            writable: descriptor.getSet === 'GET_SET',
            form: descriptor.formFlag === 0x02 ? 'enum' : descriptor.formFlag === 0x01 ? 'range' : 'none',
            ...(allowedValues ? { allowedValues } : {}),
            ...(descriptor.minimumValue !== undefined ? { minimumValue: descriptor.minimumValue } : {}),
            ...(descriptor.maximumValue !== undefined ? { maximumValue: descriptor.maximumValue } : {}),
            ...(descriptor.stepSize !== undefined ? { stepSize: descriptor.stepSize } : {}),
            ...(unrecognized && { unrecognized }),
        }
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        this.emitter.on<EventParams<E>>(event.name, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        if (handler) {
            this.emitter.off<EventParams<E>>(event.name, handler)
        } else {
            this.emitter.removeAllListeners(event.name)
        }
    }

    async getAperture(): Promise<string> {
        return this.get(this.registry.properties.FNumber)
    }

    async setAperture(value: string): Promise<void> {
        return this.setStandardProperty('FNumber', value)
    }

    async getShutterSpeed(): Promise<string> {
        return this.get(this.registry.properties.ExposureTime)
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.setStandardProperty('ExposureTime', value)
    }

    async getIso(): Promise<string> {
        return this.get(this.registry.properties.ExposureIndex)
    }

    async setIso(value: string): Promise<void> {
        return this.setStandardProperty('ExposureIndex', value)
    }

    /** One InitiateCapture. With info or data, resolves with the new object's handle once ObjectAdded names it. */
    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        objectHandle?: number
    }> {
        if (!includeInfo && !includeData) {
            const captureResponse = await this.send(this.registry.operations.InitiateCapture, {})
            if (captureResponse.code !== OK.code) {
                throw new PTPResponseError(
                    captureResponse.code,
                    `InitiateCapture returned 0x${captureResponse.code.toString(16)}`
                )
            }
            return {}
        }

        const capturedImageObjectHandle = await this.initiateCaptureAndWaitForObjectHandle()
        // The shutter has fired: a failure from here on leaves a photo that may exist, never a retry.
        return afterShutterRelease(async () => {
            let info: ObjectInfo | undefined = undefined
            let data: Uint8Array | undefined = undefined

            if (includeInfo) {
                const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                    ObjectHandle: capturedImageObjectHandle,
                })
                if (objectInfoResponse.code !== OK.code)
                    throw new PTPResponseError(objectInfoResponse.code, undefined, { operation: 'GetObjectInfo' })
                info = objectInfoResponse.data
            }
            if (includeData) {
                const objectResponse = await this.send(
                    this.registry.operations.GetObject,
                    {
                        ObjectHandle: capturedImageObjectHandle,
                    },
                    undefined,
                    (info?.objectCompressedSize || this.liveViewBufferSize) + this.bufferPadding
                )
                if (objectResponse.code !== OK.code)
                    throw new PTPResponseError(objectResponse.code, undefined, { operation: 'GetObject' })
                data = objectResponse.data
            }

            return {
                info: info,
                data: data,
                objectHandle: capturedImageObjectHandle,
            }
        })
    }

    async captureLiveView(_options: { includeInfo?: boolean; includeData?: boolean } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        throw new CameraUnsupportedError('getLiveViewFrame', 'Live view capture not supported on generic PTP cameras')
    }

    async sendStartRecording(): Promise<void> {
        throw new CameraUnsupportedError('startRecording', 'Video recording not supported on generic PTP cameras')
    }

    async sendStopRecording(): Promise<void> {
        throw new CameraUnsupportedError('stopRecording', 'Video recording not supported on generic PTP cameras')
    }

    /*
     * WARNING: This operation is extremely slow for >100 objects/images on card.
     */
    async listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }> {
        type StorageEntry = { info: StorageInfo; objects: { [objectHandle: number]: ObjectInfo } }
        const result: { [storageId: number]: StorageEntry } = {}

        const storageIdsResponse = await this.send(this.registry.operations.GetStorageIDs, {})
        if (storageIdsResponse.code !== 0x2001)
            throw new PTPResponseError(storageIdsResponse.code, undefined, { operation: 'GetStorageIDs' })
        const storageIds = storageIdsResponse.data
        if (!Array.isArray(storageIds)) throw new PTPDecodeError('GetStorageIDs returned no storage dataset')

        for (const storageId of storageIds) {
            if ((storageId & 0xffff) === 0) continue
            // Get info for this storage
            const storageInfoResponse = await this.send(this.registry.operations.GetStorageInfo, {
                StorageID: storageId,
            })
            if (storageInfoResponse.code !== 0x2001)
                throw new PTPResponseError(storageInfoResponse.code, undefined, { operation: 'GetStorageInfo' })
            const storageInfo = storageInfoResponse.data
            if (!storageInfo) throw new PTPDecodeError('GetStorageInfo returned no card dataset')

            // Prepare container for objects in this storage
            const storageObjects: { [objectHandle: number]: ObjectInfo } = {}

            // Get all object handles for this storage
            const objectIdsResponse = await this.send(this.registry.operations.GetObjectHandles, {
                StorageID: storageId,
            })
            if (objectIdsResponse.code !== 0x2001)
                throw new PTPResponseError(objectIdsResponse.code, undefined, { operation: 'GetObjectHandles' })
            const objectHandles = objectIdsResponse.data
            if (!Array.isArray(objectHandles)) throw new PTPDecodeError('GetObjectHandles returned no object dataset')

            // Get detailed info for each object handle
            for (const objectHandle of objectHandles) {
                const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                    ObjectHandle: objectHandle,
                })
                if (objectInfoResponse.code !== 0x2001)
                    throw new PTPResponseError(objectInfoResponse.code, undefined, { operation: 'GetObjectInfo' })
                if (!objectInfoResponse.data) throw new PTPDecodeError('GetObjectInfo returned no object metadata')
                storageObjects[objectHandle] = objectInfoResponse.data
            }

            result[storageId] = {
                info: storageInfo,
                objects: storageObjects,
            }
        }

        return result
    }

    /** Downloads an object in chunks; onProgress reports bytes received after each chunk. */
    async getObject(
        objectHandle: number,
        objectSize: number,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array> {
        if (!Number.isSafeInteger(objectSize) || objectSize < 0)
            throw new Error('Object size must be a nonnegative safe integer')
        return this.downloadObjectChunks(
            objectHandle,
            objectSize,
            'GetPartialObject',
            async (offset, bytesToRead) => {
                const response = await this.send(
                    this.registry.operations.GetPartialObject,
                    {
                        ObjectHandle: objectHandle,
                        Offset: offset,
                        MaxBytes: bytesToRead,
                    },
                    undefined,
                    bytesToRead + 12
                )

                if (response.code !== OK.code)
                    throw new PTPResponseError(
                        response.code,
                        `GetPartialObject returned 0x${response.code.toString(16)}`
                    )
                return response.data
            },
            onProgress,
            signal
        )
    }

    /** One transfer loop for all drivers; each driver retains its wire request and response validation. */
    protected async downloadObjectChunks(
        objectHandle: number,
        objectSize: number,
        operation: string,
        readChunk: (offset: number, bytes: number) => Promise<Uint8Array | undefined>,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array> {
        this.logger.startTransfer(objectHandle, this.sessionId!, 0, operation, objectSize)
        try {
            const chunks: Uint8Array[] = []
            let offset = 0
            while (offset < objectSize) {
                // Cancellation between chunks leaves no abandoned transaction in flight.
                signal?.throwIfAborted()
                const bytes = Math.min(this.defaultChunkSize, objectSize - offset)
                const chunk = await readChunk(offset, bytes)
                if (!chunk?.length || chunk.length > bytes)
                    throw new Error(`${operation} returned an empty or oversized chunk`)
                this.logger.updateTransferProgress(objectHandle, chunk.length, this.getCurrentTransactionId())
                chunks.push(chunk)
                offset += chunk.length
                onProgress?.(offset, objectSize)
            }
            const completeFile = new Uint8Array(offset)
            offset = 0
            for (const chunk of chunks) {
                completeFile.set(chunk, offset)
                offset += chunk.length
            }
            this.logger.completeTransfer(objectHandle)
            return completeFile
        } catch (error) {
            this.logger.completeTransfer(
                objectHandle,
                error instanceof PTPResponseError ? error.code : IncompleteTransfer.code
            )
            throw error
        }
    }

    public resolveCodec<T>(codec: CodecDefinition<T> | CodecDefinition<any>): CodecInstance<T> {
        if (typeof codec === 'function') {
            return codec(this.registry)
        }

        return codec
    }

    protected async waitMs(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    protected handleEvent(event: PTPEvent): void {
        const eventDef = Object.values(this.registry.events).find(e => e.code === event.code) as
            EventDefinition | undefined
        if (!eventDef) return

        // Decode event parameters using their codecs
        const decodedParams: Record<string, number | bigint | string> = {}
        const encodedParams = event.parameters || []

        for (let i = 0; i < eventDef.parameters.length; i++) {
            const paramDef = eventDef.parameters[i]
            if (!paramDef || i >= encodedParams.length) continue

            const codec = this.resolveCodec(paramDef.codec)
            const rawValue = encodedParams[i]

            // If raw value is a number/bigint/string, decode it
            if (typeof rawValue === 'number' || typeof rawValue === 'bigint' || typeof rawValue === 'string') {
                // Encode to bytes first, then decode to get the proper type
                const bytes = codec.encode(rawValue)
                const result = codec.decode(bytes)
                decodedParams[paramDef.name] = result.value
            } else {
                decodedParams[paramDef.name] = rawValue
            }
        }

        // If event has a PropertyCode parameter, look up and add PropertyName
        if (decodedParams.PropertyCode !== undefined && typeof decodedParams.PropertyCode === 'number') {
            const property = Object.values(this.registry.properties).find(p => p.code === decodedParams.PropertyCode)
            if (property) {
                decodedParams.PropertyName = property.name
            }
        }

        this.logger.addLog({
            type: 'ptp_event',
            level: 'info',
            sessionId: this.sessionId!,
            eventCode: eventDef.code,
            eventName: eventDef.name,
            encodedParams,
            decodedParams,
        })

        this.emitter.emit<Record<string, number | bigint | string>>(eventDef.name, decodedParams)
    }

    /**
     * Sends InitiateCapture and resolves with the new object's handle. A refused InitiateCapture is
     * CameraRefusedError; once it is sent, a missing ObjectAdded is CameraOutcomeUnknownError.
     */
    protected initiateCaptureAndWaitForObjectHandle(timeoutMilliseconds = 15_000): Promise<number> {
        return new Promise((resolve, reject) => {
            const objectAdded = this.registry.events.ObjectAdded
            const cleanup = () => {
                clearTimeout(timeout)
                this.off(objectAdded, handleObjectAdded)
            }
            const fail = (error: Error) => {
                cleanup()
                reject(error)
            }
            const handleObjectAdded = (event: { ObjectHandle?: number }) => {
                if (!event.ObjectHandle) return
                cleanup()
                resolve(event.ObjectHandle)
            }
            const timeout = setTimeout(
                () =>
                    fail(
                        shutterOutcomeUnknown(
                            new Error(`Timed out after ${timeoutMilliseconds}ms waiting for the captured image object`)
                        )
                    ),
                timeoutMilliseconds
            )

            this.on(objectAdded, handleObjectAdded)
            void this.send(this.registry.operations.InitiateCapture, {})
                .then(response => {
                    if (response.code !== OK.code) {
                        fail(
                            shutterRefused(
                                new PTPResponseError(
                                    response.code,
                                    `InitiateCapture returned 0x${response.code.toString(16)}`
                                )
                            )
                        )
                    }
                })
                .catch(error => fail(shutterOutcomeUnknown(error)))
        })
    }

    protected getCurrentTransactionId(): number {
        return this.transactionId
    }

    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) >>> 0
        if (this.transactionId === 0) this.transactionId = 1
        return this.transactionId
    }

    /** PTP command parameters occupy unsigned 32-bit slots even when a definition uses a narrower value codec. */
    private buildCommand(code: number, transactionId: number, params: Uint8Array[]): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        if (params.length > 5) throw new Error('PTP commands accept at most five parameters')
        const parameterSlots = params.map(parameter => {
            if (parameter.length > 4) throw new Error('PTP command parameters must fit a 32-bit slot')
            const slot = new Uint8Array(4)
            slot.set(parameter)
            return slot
        })
        const paramBytes = parameterSlots.length * 4
        const length = 12 + paramBytes

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(1),
            u16.encode(code),
            u32.encode(transactionId),
            ...parameterSlots,
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    private buildData(code: number, transactionId: number, data: Uint8Array): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        const length = 12 + data.length

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(2),
            u16.encode(code),
            u32.encode(transactionId),
            data,
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    /** Response (and response-as-data) containers carry up to five UINT32 parameters; vendor commands report status there. */
    private decodeResponseParameters(payload: Uint8Array): number[] | undefined {
        if (payload.length === 0 || payload.length % 4 !== 0) return undefined

        const parameters: number[] = []
        for (let offset = 0; offset < payload.length; offset += 4) {
            parameters.push(this.registry.codecs.uint32.decode(payload, offset).value)
        }
        return parameters
    }

    /**
     * @internal The Camera this driver serves, set by Camera when it creates the driver. The
     * helpers that still take the façade read it; a driver used without a Camera has none.
     */
    owner?: Camera

    /** TRANSITIONAL: the façade for helpers that still take one. */
    protected requireOwner(): Camera {
        if (!this.owner) throw new Error('This driver is not attached to a Camera')
        return this.owner
    }

    // Driver contract (`@camera/driver`): the standard PTP operations every driver inherits. Modules
    // that import a brand driver are loaded on first use, so this module never imports one.
    #mediaGroup?: MediaCapability
    #info?: { sessionId: number | null; info: CameraInfo }
    #clockCheck?: { sessionId: number | null; reason: string | undefined }

    /** The card-media group; Sony overrides it with its own card index. */
    protected async mediaGroup(): Promise<MediaCapability> {
        const { ptpMediaCapability } = await import('@vendors/generic/ptp-media')
        return (this.#mediaGroup ??= ptpMediaCapability(this, this.requireOwner()))
    }

    /** Sony's remote session overrides this to say whether it may write its two host preferences. */
    async openSession(device: DeviceDescriptor | undefined, _options: { observeOnly: boolean }): Promise<void> {
        await this.connect(device)
    }

    /** Make, model and firmware from GetDeviceInfo, read once per session. */
    async getInfo(): Promise<CameraInfo> {
        return reportingRefusals('getInfo', async () => {
            if (this.#info && this.#info.sessionId === this.sessionId) return { ...this.#info.info }
            const response = await this.send(this.registry.operations.GetDeviceInfo, {})
            if (response.code !== OK.code)
                throw new CameraRefusedError(
                    'getInfo',
                    `The camera refused GetDeviceInfo (0x${response.code.toString(16).padStart(4, '0')})`
                )
            if (!response.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')
            const { manufacturer, model, deviceVersion, serialNumber } = response.data
            const lensMount = lensMountForModel(this.vendorId, model)
            const info: CameraInfo = {
                manufacturer: (this.vendorId !== null && MAKES[this.vendorId]) || manufacturer.trim(),
                model: model.trim(),
                firmware: deviceVersion.trim(),
                ...(serialNumber && { serialNumber }),
                ...(lensMount && { lensMount }),
                connection: this.connectionKind(),
            }
            this.#info = { sessionId: this.sessionId, info }
            return { ...info }
        })
    }

    /** Sony's authenticated SDK channel is carried over Wi-Fi IP, but it is not PTP/IP. */
    private connectionKind(): CameraInfo['connection'] {
        if (this.transport instanceof SonyRemoteSdkTransport) return 'wifi'
        return this.transport.getType() === TransportType.USB ? 'usb' : 'ip'
    }

    async getCapabilities(requested?: CameraControlId): Promise<CameraCapabilities> {
        const { readCameraCapabilities } = await import('@vendors/camera-controls')
        return readCameraCapabilities(this, requested)
    }

    async setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState> {
        const { writeCameraControl } = await import('@vendors/camera-controls')
        return writeCameraControl(this.requireOwner(), this, id, value, context)
    }

    /** A card object's full size when ObjectInfo reports 0xffffffff; a vendor with a 64-bit query overrides this. */
    async fullObjectSize(_objectHandle: number, reportedBytes: number, operation = 'downloadMedia'): Promise<number> {
        if (reportedBytes !== OBJECT_SIZE_UNREPORTED) return reportedBytes
        throw new CameraUnsupportedError(operation, 'This camera does not report the full size of files larger than 4 GiB')
    }

    /** Standard PTP: InitiateCapture confirmed by ObjectAdded. These bodies save to their card first. */
    async takePhoto({ autofocus, destination }: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile> {
        return classified(async confirmed => {
            if (!autofocus)
                throw new CameraUnsupportedError(
                    'takePhoto',
                    'This camera has no documented release without autofocus over standard PTP; nothing was sent'
                )
            const wantsData = destination === 'computer'
            const capture = await this.captureImage({ includeInfo: true, includeData: wantsData })
            confirmed()
            return cardObjectFile(capture, wantsData)
        })
    }

    async getCardStatus(): Promise<CardStatus[]> {
        return (await this.mediaGroup()).getCardStatus()
    }

    async listMedia(): Promise<MediaItem[]> {
        return (await this.mediaGroup()).listMedia()
    }

    async getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array> {
        return (await this.mediaGroup()).getMediaPreview(id, size)
    }

    async downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array> {
        return (await this.mediaGroup()).downloadMedia(id, options)
    }

    /** Sony's property snapshot, Canon's EOS level after the standard BatteryLevel, the standard BatteryLevel elsewhere. */
    async getBattery(): Promise<Battery> {
        const { batteryFromPower, readCameraPower } = await import('@vendors/camera-power')
        const vendor = this.vendorId === VendorIDs.SONY ? 'sony' : this.vendorId === VendorIDs.CANON ? 'canon' : 'standard'
        return reportingRefusals('getBattery', async () => batteryFromPower(await readCameraPower(this.requireOwner(), vendor)))
    }

    /** The standard DateTime property; Sony overrides this with its Date/Time Setting. */
    async setClock(moment: Date): Promise<void> {
        return reportingRefusals('setClock', () => setStandardClock(this, moment))
    }

    subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        return emittedEvents(this, event, handler)
    }

    async availability(
        operation: CameraOperationName,
        _capabilities: CameraCapabilities
    ): Promise<OperationAvailability | undefined> {
        if (
            operation === 'getCardStatus' ||
            operation === 'listMedia' ||
            operation === 'getMediaPreview' ||
            operation === 'downloadMedia'
        )
            return (await (await this.mediaGroup()).availability?.())?.[operation]
        if (operation !== 'setClock') return undefined
        if (this.#clockCheck?.sessionId !== this.sessionId)
            this.#clockCheck = {
                sessionId: this.sessionId,
                reason: await reportingRefusals('setClock', () => standardClockUnavailable(this)),
            }
        return this.#clockCheck.reason ? { supported: false, reason: this.#clockCheck.reason } : undefined
    }
}

/** The make people use for each USB vendor; another vendor keeps the name its DeviceInfo gives. */
export const MAKES: Record<number, string> = {
    [VendorIDs.SONY]: 'Sony',
    [VendorIDs.CANON]: 'Canon',
    [VendorIDs.NIKON]: 'Nikon',
    [VendorIDs.FUJIFILM]: 'Fujifilm',
    [VendorIDs.PANASONIC]: 'Panasonic',
    [VendorIDs.OLYMPUS]: 'Olympus',
    [VendorIDs.OM_DIGITAL]: 'OM System',
    [VendorIDs.LEICA]: 'Leica',
    [VendorIDs.SIGMA]: 'Sigma',
}

/**
 * The lens mount for model families whose mount follows from the name: Sony ILCE/ILME bodies are
 * E-mount and ILCA bodies A-mount, Nikon Z bodies Z-mount and Nikon D bodies F-mount, Canon EOS R
 * bodies RF-mount. Any other model reports no mount rather than a guess.
 */
export function lensMountForModel(vendorId: number | null, model: string): string | undefined {
    const name = model.trim()
    if (vendorId === VendorIDs.SONY) {
        if (/^IL(CE|ME)-/i.test(name)) return 'E'
        if (/^ILCA-/i.test(name)) return 'A'
    }
    if (vendorId === VendorIDs.NIKON) {
        if (/^Z\s?[0-9fc]/i.test(name)) return 'Z'
        if (/^D\d/i.test(name)) return 'F'
    }
    if (vendorId === VendorIDs.CANON && /\bEOS R(\d|P\b|\b)/i.test(name)) return 'RF'
    return undefined
}

/** Event names, across the standard and vendor registries, that mean each public event. */
export const EVENT_DEFINITION_NAMES: Record<CameraEventName, readonly string[]> = {
    settingsChanged: ['DevicePropChanged', 'SDIE_DevicePropChanged'],
    // A Nikon SDRAM object is a capture to the computer, not a file on the card.
    mediaAdded: ['ObjectAdded', 'SDIE_ObjectAdded'],
}

export function registryEvents(driver: GenericCamera, event: CameraEventName): EventDefinition[] {
    const events: Record<string, EventDefinition> = driver.registry.events
    return Object.values(events).filter(definition => EVENT_DEFINITION_NAMES[event].includes(definition.name))
}

/** Events the driver emits as they arrive: the USB interrupt pipe, or Canon's own event loop. */
export function emittedEvents(driver: GenericCamera, event: CameraEventName, handler: CameraEventHandler): () => void {
    const definitions = registryEvents(driver, event)
    const listener = () => handler()
    for (const definition of definitions) driver.on(definition, listener)
    return () => {
        for (const definition of definitions) driver.off(definition, listener)
    }
}
