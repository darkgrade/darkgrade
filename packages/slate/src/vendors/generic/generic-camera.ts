import type { PhotoVideoMode } from '@camera/settings/values'
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
    CameraOperationName,
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
import { validateProtocol, type ProtocolEvidence, type StatePhase } from '@contribute/protocol'
import type { DiagnosticEntry } from '@contribute/schema'
import { noteCallResponse } from '@core/call-context'
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
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { DeviceBusy, IncompleteTransfer, OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { buildContainer, ContainerType, MAXIMUM_PARAMETERS } from '@ptp/container'
import { TransactionChannel, type TransactionPolicy } from '@ptp/transaction-channel'
import type { CodecDefinition, CodecInstance, CodecType } from '@ptp/types/codec'
import { EventDefinition, EventEmitter } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { batteryFromPower, readStandardPower } from '@vendors/power-reading'
import { observeStandardControls, type ControlObservation, type ControlWrite } from '@vendors/generic/control-observation'
import type { CameraPower } from '@workflows/camera-power'
import { vendorEntry } from '@vendors/vendors'
import type { MediaCapability } from '@vendors/generic/capability-groups'
import { OBJECT_SIZE_UNREPORTED, reportingRefusals } from '@vendors/generic/ptp-object-index'
import { afterShutterRelease, cardObjectFile, classified, shutterOutcomeUnknown, shutterRefused } from '@vendors/generic/shutter-outcome'
import { setStandardClock, standardClockUnavailable } from '@vendors/generic/standard-clock'
import { messageOf } from '@vendors/generic/typed-failure'
import { requestEvidence, protocolEvidence, stateSnapshotEvidence, type CachedDiagnosticSetting } from '@vendors/protocol-evidence'
import { createPTPRegistry, Registry } from '@vendors/registry'

/** How long a camera takes to enumerate again after a USB port reset. */
const PORT_RESET_SETTLE_MS = 1500
/** A camera needs a moment after a Device Reset Request before it accepts OpenSession. */
const DEVICE_RESET_SETTLE_MS = 500


/** ISO 15740 standard operation codes; their DeviceBusy answers mean "not performed, retry later". */
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

export function standardPropertyState(descriptor: DevicePropDesc): StandardPropertyState {
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

/** The release options a driver's captureImage takes; see `GenericCamera.captureOptions`. */
export interface CaptureOptions {
    memory: boolean
    withoutAutofocus: boolean
    rawCompression: boolean
}

/** What a driver says about recording to one card; brands may add their own evidence fields. */
export interface StorageRecording {
    writable: boolean
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
            const settings = this.diagnosticSettings.values()
            this.recordProtocol(stateSnapshotEvidence(this.vendorId ?? 0, settings, workflow, phase, performance.now()))
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
    async observeResponses<T>(observe: (operationName: string, responseCode: number) => void, work: () => Promise<T>): Promise<T> {
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
            if ((evidence.type === 'descriptor' || evidence.type === 'property-value') && evidence.current !== undefined) {
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
        // Requests and what they returned happen once each; only facts about the body are deduplicated.
        if (!['inventory', 'unknown', 'descriptor', 'property-value', 'unrecognized-value', 'benchmark'].includes(scoped.type)) {
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
        // A fact about an identified body is shared again only when it changes or after six hours.
        // Each kind (vendor scope, operation, field set) is remembered separately so kinds sharing a key do not replace each other.
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
            this.warn(`Discarded PTP container 0x${container.code.toString(16).padStart(4, '0')}: ${reason}`)
        )
        this.registry = createPTPRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)

        this.transport.on?.(event => this.handleEvent(event))
        for (const [method, operation, transition] of [
            ['sendStartRecording', 'record_start', 'start'],
            ['sendStopRecording', 'record_stop', 'stop'],
        ] as const) {
            const work = this[method].bind(this)
            this[method] = () =>
                this.telemetry.operation(operation, async () => {
                    this.recordStateSnapshot('recording', `before-${transition}`)
                    try {
                        await work()
                        this.recordStateSnapshot('recording', `after-${transition}`)
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
            this.clearRecoveryState()
        } else await this.resynchronizeIfNeeded()
    }

    /** @internal Camera records each public call it was asked for in this connection's telemetry session. */
    recordApiCall(entry: DiagnosticEntry): void {
        this.telemetry.record(entry)
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
            this.clearRecoveryState()
            await this.waitMs(PORT_RESET_SETTLE_MS)
            await this.connectTransport(device)
            await this.openFreshSession()
        }
    }

    /** A new session's id: never 0, which ISO 15740 reserves (OpenSession refuses it with InvalidParameter). */
    protected createSessionId(): number {
        return 1 + Math.floor(Math.random() * 0xfffffffe)
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
            throw new PTPRecoveryRequiredError('Transport recovery is still running; disconnect must wait', this.lastFailure)
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
     * Brings back a camera that has stopped answering, using only software. Each step runs only if
     * the one before failed and must read a fresh identity and pass the vendor's readiness check:
     * a fresh session, then the class Device Reset Request, then a libusb port reset (a replug).
     * An absent camera is waited for up to `waitForDeviceMilliseconds`. The transport is left
     * closed; when no step works, `needsPhysicalAction` is true: only then are power or hub cycling warranted.
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
                steps.push({ step, ok: false, durationMilliseconds: Date.now() - begun, detail: messageOf(error) })
                return undefined
            }
        }
        try {
            const present = await this.waitForTransport(device, waitForDevice)
            if (!present.ok) {
                steps.push({ step: 'enumerate', ok: false, durationMilliseconds: Date.now() - started, detail: present.detail })
                return { recovered: false, needsPhysicalAction: true, steps, durationMilliseconds: Date.now() - started }
            }
            let identity = await attempt('session', () => this.openFreshSession())
            if (!identity)
                identity = await attempt('device-reset', async () => {
                    if (!this.transport.isConnected()) await this.connectTransport(device)
                    // The recovery policy bounds this reset by stepTimeout.
                    await this.resetUSBTransport()
                    this.clearRecoveryState()
                    await this.waitMs(DEVICE_RESET_SETTLE_MS)
                    await this.openFreshSession()
                })
            if (!identity && options.allowPortReset !== false && this.transport.resetPort)
                identity = await attempt('port-reset', async () => {
                    if (!this.transport.isConnected()) await this.connectTransport(device)
                    await this.withStepTimeout(this.transport.resetPort!(), stepTimeout, 'the USB port reset')
                    this.sessionId = null
                    this.clearRecoveryState()
                    await this.waitMs(PORT_RESET_SETTLE_MS)
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
        return { manufacturer: String(info.manufacturer ?? ''), model: String(info.model ?? ''), firmware: String(info.deviceVersion ?? '') }
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
                last = messageOf(error)
            }
            if (Date.now() >= deadline) return { ok: false, detail: last }
            await this.waitMs(500)
        }
    }

    private async withStepTimeout<T>(work: Promise<T>, milliseconds: number, what: string): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
            return await Promise.race([
                work,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`${what} did not complete within ${milliseconds} ms`)), milliseconds)
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
     * Queues one transaction: PTP allows only one in flight, and overlapping vendor event polls would
     * interleave on the shared endpoints. Every phase is bounded by the transaction policy's timeout
     * and failures are typed (`PTPTimeoutError`, `PTPProtocolError`, `PTPDecodeError`,
     * `PTPDisconnectedError`). A non-OK response code is returned, not thrown.
     */
    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const transaction = () => this.sendTransaction(operation, params, data, maxDataLength)
        const result = this.transactionQueue.then(transaction, transaction)
        // Keep the chain alive after a rejection so one failed transaction cannot wedge the queue.
        this.transactionQueue = result.then(() => undefined, () => undefined)
        const response = await result
        for (const observe of this.responseObservers) observe(operation.name, response.code)
        if (response.code !== OK.code) {
            noteCallResponse(response.code)
            await this.explain(operation.code, response)
        }
        if (response.code !== OK.code || !('data' in response) || !response.data) return response
        if (operation.code === 0x1001) await this.telemetry.identify(response.data as unknown as DeviceInfo)
        try {
            for (const evidence of protocolEvidence(this.vendorId ?? 0, this.registry, operation.code, response.data))
                this.recordProtocol(evidence, operation.code)
        } catch {
            /* A diagnostics failure must not turn a completed camera read into a failure. */
        }
        return response
    }

    private async explain(operation: number, response: { code: number }) {
        const transactionId = this.responseTransactions.get(response)
        if (this.explaining || transactionId === undefined) return
        this.explaining = true
        try {
            await this.explainResponse(operation, response.code, transactionId)
        } catch {
            /* An explanation is diagnostics only: the caller still gets the camera's own response. */
        } finally {
            this.explaining = false
        }
    }
    /** The transaction each response answered, for explanations recorded after it returns. */
    private readonly responseTransactions = new WeakMap<object, number>()

    private async sendTransaction<Op extends OperationDefinition>(
        operation: Op, params: OperationParams<Op>, data?: Uint8Array, maxDataLength?: number
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

        const transaction = () => this.runTransaction(operation, paramsRecord, encodedParams, data, maxDataLength)
        const standard = operation.code >= STANDARD_OPERATIONS.from && operation.code <= STANDARD_OPERATIONS.to
        if (!standard) return transaction()
        return this.channel.retryWhileBusy(transaction, response => response.code === DeviceBusy.code, milliseconds => this.waitMs(milliseconds))
    }

    private encodeParameters(operation: OperationDefinition, paramsRecord: Record<string, number | bigint | string>): Uint8Array[] {
        const encodedParams: Uint8Array[] = []
        for (const paramDef of operation.operationParameters) {
            if (!paramDef) continue

            const value = paramsRecord[paramDef.name] ?? ('defaultValue' in paramDef ? paramDef.defaultValue : undefined)
            if (value === undefined) {
                if (paramDef.required) throw new Error(`Required parameter ${paramDef.name} missing`)
                continue
            }
            const encoded = this.resolveCodec(paramDef.codec).encode(value)
            if (encoded.length > 4) throw new Error(`Parameter ${paramDef.name} exceeds a UINT32 slot`)
            encodedParams.push(encoded)
        }
        if (encodedParams.length > MAXIMUM_PARAMETERS) throw new Error('PTP commands accept at most five parameters')
        return encodedParams
    }

    /**
     * After an abandoned or malformed transfer, runs the caller's TransactionPolicy.recoverTransport,
     * or over USB the class Device Reset Request (as libgphoto2 does), a bounded settle and a fresh
     * OpenSession. If that fails, or there is no class reset (PTP/IP), commands fail with
     * PTPRecoveryRequiredError until disconnect/connect. A timed-out wait never lets a command race it.
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
                () => void (attempt.status = 'succeeded'),
                error => void Object.assign(attempt, { status: 'failed', failure: error })
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
            throw new PTPRecoveryRequiredError('Transport recovery is still running; no further command was sent', this.lastFailure)
        if (attempt.status === 'failed')
            throw new PTPRecoveryRequiredError(
                `${attempt.automatic ? 'Automatic USB reset' : 'Transport recovery'} failed: ${messageOf(attempt.failure)}`,
                { ...this.lastFailure, cause: attempt.failure }
            )
        if (this.channel.hasPendingIO)
            throw new PTPRecoveryRequiredError('Recovery returned while abandoned transport I/O is still running', this.lastFailure)
        const failure = this.lastFailure
        this.clearRecoveryState()
        if (!attempt.automatic || attempt.previousSessionId === null) return
        try {
            await this.reopenSessionAfterReset(attempt.previousSessionId)
        } catch (error) {
            // The camera did not come back after the reset: latch until disconnect/connect.
            this.sessionId = null
            this.needsResynchronization = true
            this.lastFailure = failure
            this.recovery = { task: Promise.resolve(), status: 'failed', failure: error, automatic: true, previousSessionId: null }
            throw new PTPRecoveryRequiredError(
                `Automatic USB reset failed to reopen the session: ${messageOf(error)}`,
                { ...failure, cause: error }
            )
        }
    }

    /** Device Reset Request, then a bounded wait until the abandoned reads and writes have settled. */
    private async resetUSBTransport(): Promise<void> {
        const timeout = this.channel.policy.timeoutMilliseconds
        await this.withStepTimeout(this.transport.classRequestReset(), timeout, 'the Device Reset Request')
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
                `could not decode ${context.what} (${bytes.length} bytes): ${messageOf(error)}`,
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
        const property = this.propertyByCode(propCode)
        if (!property) return undefined
        const described = { propertyName: property.name, propertyCode: propCode }
        try {
            return { ...described, value: this.decodeWith(property.codec, receivedData, decodeContext(property.name)) }
        } catch (error) {
            // A value the property's codec has no name for (newer firmware, another body's choices) is
            // still a well-formed value: keep the raw number, as a descriptor does, instead of failing the read.
            const datatype = getDatatypeByCode(property.datatype)?.codec
            if (!datatype) throw error
            try {
                return { ...described, value: this.decodeWith(datatype, receivedData, decodeContext(property.name)), unrecognized: true }
            } catch {
                throw error
            }
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
            const response = await this.exchange(operation, paramsRecord, encodedParams, transactionId, sessionId, data, maxDataLength)
            this.recordRequest(operation, paramsRecord, data, transactionId, response)
            this.responseTransactions.set(response, transactionId)
            return response
        } catch (error) {
            this.recordRequest(operation, paramsRecord, data, transactionId)
            if (error instanceof PTPTimeoutError || error instanceof PTPProtocolError) {
                this.needsResynchronization = true
                this.lastFailure = { operation: operation.name, transactionId, cause: error }
            }
            // Transport errors keep their own type; a transport that went away also ended the session.
            if (!this.transport.isConnected()) this.sessionId = null
            throw error
        }
    }

    /** The values, positions and byte counts a transaction asked for, from what it already holds: no extra reads. */
    private recordRequest(
        operation: OperationDefinition,
        parameters: Record<string, number | bigint | string>,
        data: Uint8Array | undefined,
        transactionId: number,
        response?: { code: number; data?: unknown }
    ) {
        try {
            const observed = (property: number) => {
                const cached = this.diagnosticSettings.get(property)
                const dataType = cached?.dataType ?? this.propertyByCode(property)?.datatype
                return cached ? { ...cached, dataType } : { dataType }
            }
            for (const evidence of requestEvidence(this.vendorId ?? 0, operation, parameters, data, transactionId, response, observed, performance.now()))
                this.recordProtocol(evidence, operation.code)
        } catch {
            /* Optional diagnostics cannot change the result of a camera transaction. */
        }
    }

    /**
     * Called once per transaction that did not answer OK, after it completed. A driver may read what
     * explains the response (Nikon reads WarningStatus after HardwareError) and record it; it must not
     * change the transaction's result, retry it, or throw.
     */
    protected async explainResponse(_operation: number, _response: number, _transactionId: number): Promise<void> {}
    private explaining = false

    private async exchange<Op extends OperationDefinition>(
        operation: Op,
        paramsRecord: Record<string, number | bigint | string>,
        encodedParams: Uint8Array[],
        transactionId: number,
        sessionId: number,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const context = { operation: operation.name, transactionId }
        const decodeContext = (what: string) => ({ ...context, what })
        const objectHandle = paramsRecord.ObjectHandle
        const transferLogId = typeof objectHandle === 'number' ? this.logger.getActiveTransfer(objectHandle) : undefined
        const logId =
            transferLogId ??
            (operation.name === 'CanonGetEventData'
                ? -1
                : this.logger.addLog({
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
                  }))
        const logDataPhase = (direction: 'in' | 'out', bytes: Uint8Array, decodedData: unknown) => {
            if (logId === -1) return
            this.logger.updateLog(logId, {
                dataPhase: {
                    timestamp: Date.now(),
                    direction,
                    bytes: bytes.length,
                    encodedData: bytes,
                    decodedData: decodedData as number | bigint | string | object | Uint8Array | undefined,
                    maxDataLength,
                },
            })
        }
        const logResponse = (code: number) => {
            if (logId !== -1) this.logger.updateLog(logId, { responsePhase: { timestamp: Date.now(), code } })
        }
        const slots = new Uint8Array(encodedParams.length * 4)
        encodedParams.forEach((parameter, index) => slots.set(parameter, index * 4))
        await this.channel.send(buildContainer(ContainerType.COMMAND, operation.code, transactionId, slots), sessionId, context)

        let receivedData: Uint8Array | undefined
        let decodedData: unknown
        let undecodableData: unknown
        if (operation.dataDirection === 'in' && data) {
            decodedData = this.describeOutgoingData(operation, paramsRecord, data)
            logDataPhase('in', data, decodedData)
            await this.channel.send(buildContainer(ContainerType.DATA, operation.code, transactionId, data), sessionId, context)
        } else if (operation.dataDirection === 'out') {
            const dataContainer = await this.channel.receive(sessionId, {
                ...context,
                operationCode: operation.code,
                dataOperationCode: operation.dataOperationCode,
                phase: 'data',
                maxLength: maxDataLength || 256 * 1024,
            })
            receivedData = dataContainer.payload
            if (dataContainer.type === ContainerType.RESPONSE) {
                logResponse(dataContainer.code)
                return {
                    code: dataContainer.code,
                    parameters: this.decodeResponseParameters(dataContainer.payload),
                    data: receivedData.length > 0 ? receivedData : undefined,
                } as OperationResponse<Op>
            }
            try {
                decodedData = this.decodeDataPhase(operation, paramsRecord, receivedData, decodeContext)
            } catch (error) {
                // Read the response first so the camera's pipe is clean for the next transaction.
                undecodableData = error
            }
            if (transferLogId === undefined) logDataPhase('out', receivedData, decodedData)
        }

        const responseContainer = await this.channel.receive(sessionId, {
            ...context,
            operationCode: operation.code,
            phase: 'response',
            maxLength: 512,
        })
        const parameters = this.decodeResponseParameters(responseContainer.payload)
        if (undecodableData !== undefined) {
            if (responseContainer.code === OK.code) throw undecodableData
            return { code: responseContainer.code, parameters, data: receivedData } as OperationResponse<Op>
        }
        // Some cameras answer an empty data phase with the dataset in the response container.
        if (operation.dataDirection === 'out' && !receivedData?.length && responseContainer.payload.length > 0) {
            receivedData = responseContainer.payload
            decodedData =
                'dataCodec' in operation && operation.dataCodec
                    ? this.decodeWith(operation.dataCodec, receivedData, decodeContext('the response payload'))
                    : undefined
            logDataPhase('out', receivedData, decodedData)
        }
        if (transferLogId === undefined) logResponse(responseContainer.code)

        let returnData: unknown = receivedData
        if (logId === -1) {
            if (receivedData?.length && 'dataCodec' in operation && operation.dataCodec)
                returnData = this.decodeWith(operation.dataCodec, receivedData, decodeContext('the data phase'))
        } else if (
            transferLogId === undefined &&
            decodedData !== undefined &&
            !operation.name.includes('GetDevicePropValue')
        )
            returnData = decodedData
        return {
            code: responseContainer.code,
            parameters: responseContainer.type === ContainerType.RESPONSE ? parameters : undefined,
            data: returnData,
        } as OperationResponse<Op>
    }

    /** The outgoing payload as the log shows it; describing it never prevents the transaction. */
    private describeOutgoingData(
        operation: OperationDefinition,
        paramsRecord: Record<string, number | bigint | string>,
        data: Uint8Array
    ): unknown {
        if (data.length === 0) return undefined
        let decoded: unknown
        if ('dataCodec' in operation && operation.dataCodec) {
            try {
                decoded = this.resolveCodec(operation.dataCodec).decode(data).value
                if (decoded) return decoded
            } catch {
                /* fall through to the property description */
            }
        }
        if (!operation.name.includes('SetDevicePropValue') && !operation.name.includes('ControlDevice')) return decoded
        const propertyCode = paramsRecord.DevicePropCode ?? paramsRecord.sdiControlCode
        const property = this.propertyByCode(propertyCode)
        if (propertyCode === undefined || !property) return decoded
        try {
            return { propertyName: property.name, propertyCode, value: this.resolveCodec(property.codec).decode(data).value }
        } catch {
            // Sony SDIO_ControlDevice sends a small signed direction payload for UINT16/UINT32 properties.
            return { propertyName: property.name, propertyCode, controlPayload: [...data] }
        }
    }

    private requireAccess(property: PropertyDefinition, access: 'Get' | 'Set'): void {
        if (!property.access.includes(access))
            throw new CameraUnsupportedError(
                property.name,
                `Property ${property.name} is not ${access === 'Get' ? 'readable' : 'writable'}`
            )
    }

    private propertyByCode(code: unknown): PropertyDefinition | undefined {
        return Object.values(this.registry.properties).find(candidate => candidate.code === code)
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        this.requireAccess(property, 'Get')
        const response = await this.send(this.registry.operations.GetDevicePropDesc, { DevicePropCode: property.code })
        if (!('data' in response) || !response.data)
            throw new PTPDecodeError(`GetDevicePropDesc returned no descriptor for ${property.name}`)
        return response.data.currentValueDecoded as CodecType<P['codec']>
    }

    /** Read a standalone value with its registered codec, without requesting a property descriptor. */
    async readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        this.requireAccess(property, 'Get')
        const operation = this.registry.operations.GetDevicePropValue
        const response = await this.send(operation, { DevicePropCode: property.code })
        if (response.code !== OK.code) throw new PTPResponseError(response.code, undefined, { operation: operation.name })
        try {
            if (!(response.data instanceof Uint8Array) || response.data.length === 0)
                throw new Error('No property value received')
            const decoded = this.resolveCodec(property.codec).decode(response.data)
            if (decoded.bytesRead !== response.data.length)
                throw new Error(`Decoded ${decoded.bytesRead} of ${response.data.length} bytes`)
            return decoded.value as CodecType<P['codec']>
        } catch (error) {
            throw new PTPDecodeError(
                `could not decode ${property.name}: ${messageOf(error)}`,
                { operation: operation.name, cause: error }
            )
        }
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        this.requireAccess(property, 'Set')
        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            this.resolveCodec(property.codec).encode(value)
        )
        if (response.code !== OK.code)
            throw new PTPResponseError(response.code, undefined, { operation: 'SetDevicePropValue' })
    }

    async getStandardPropertyStates(propertyNameOrCode?: string | number): Promise<StandardPropertyState[]> {
        const deviceInfoResponse = await this.send(this.registry.operations.GetDeviceInfo, {})
        if (deviceInfoResponse.code !== OK.code)
            throw new PTPResponseError(deviceInfoResponse.code, undefined, { operation: 'GetDeviceInfo' })
        if (!deviceInfoResponse.data) throw new PTPDecodeError('GetDeviceInfo returned no device dataset')
        const states: StandardPropertyState[] = []
        for (const code of deviceInfoResponse.data.devicePropertiesSupported) {
            const property = this.propertyByCode(code)
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
                states.push(standardPropertyState(response.data))
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
                this.warn(
                    `Could not decode advertised property 0x${code.toString(16).padStart(4, '0')}`,
                    messageOf(error)
                )
            }
        }
        return states
    }

    private warn(...args: string[]): void {
        this.logger.addLog({ type: 'console', level: 'warn', consoleLevel: 'warn', args })
    }

    async setStandardProperty(propertyNameOrCode: string | number, requestedValue: string | number): Promise<void> {
        const [state] = await this.getStandardPropertyStates(propertyNameOrCode)
        if (!state)
            throw new CameraUnsupportedError(String(propertyNameOrCode), `The attached camera does not advertise ${propertyNameOrCode}`)
        if (!state.writable) throw new CameraUnsupportedError(state.name, `${state.name} is read-only on the attached camera`)

        const property = this.propertyByCode(state.code)
        if (!property)
            throw new CameraUnsupportedError(state.name, `${state.codeHex} has no standard PTP property definition`)

        let value: number | bigint | string = requestedValue
        if (state.allowedValues?.length) {
            const matched = state.allowedValues.find(candidate => String(candidate) === String(requestedValue))
            if (matched === undefined)
                throw new CameraRefusedError(
                    state.name,
                    `${requestedValue} is not advertised for ${state.name}; choose ${state.allowedValues.map(String).join(', ')}`
                )
            value = matched
        }
        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            this.resolveCodec(property.codec).encode(value)
        )
        if (response.code !== OK.code)
            throw new PTPResponseError(response.code, `SetDevicePropValue for ${state.name} returned 0x${response.code.toString(16)}`)
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        this.emitter.on<EventParams<E>>(event.name, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        if (handler) this.emitter.off<EventParams<E>>(event.name, handler)
        else this.emitter.removeAllListeners(event.name)
    }

    /**
     * The release options this driver's captureImage takes beyond a plain card release: a transfer
     * to host memory, a release without autofocus, a per-capture RAW compression.
     */
    readonly captureOptions: CaptureOptions = { memory: false, withoutAutofocus: false, rawCompression: false }

    /**
     * controls(), observe: the property states behind each canonical control. Standard PTP reads
     * each mapped descriptor; brands read their own inventory. A full read is given its DeviceInfo.
     */
    async observeControlStates(requested?: CameraControlId, deviceInfo?: DeviceInfo): Promise<ControlObservation> {
        return observeStandardControls(this, requested, deviceInfo)
    }

    /** controls(), write: send one admitted control write once; the caller confirms it by readback. */
    async writeControlValue(write: ControlWrite): Promise<void> {
        await this.setStandardProperty(write.state.source.code, write.vendorLabel)
    }

    /** Sends the vendor's photo/video switch once; the caller confirms it by polled readback. */
    async sendPhotoVideoMode(_requested: PhotoVideoMode, _state: CameraControlState): Promise<void> {
        throw new CameraUnsupportedError('photoVideoMode', 'Photo / video is not supported by this camera')
    }

    /** Holds still mode across one capture and its transfer; a body without a movie mode just captures. */
    async withStillMode<Result>(capture: () => Promise<Result>): Promise<Result> {
        return capture()
    }

    /** One InitiateCapture. With info or data, resolves with the new object's handle once ObjectAdded names it. */
    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        objectHandle?: number
    }> {
        if (!includeInfo && !includeData) {
            const response = await this.send(this.registry.operations.InitiateCapture, {})
            if (response.code !== OK.code)
                throw new PTPResponseError(response.code, `InitiateCapture returned 0x${response.code.toString(16)}`)
            return {}
        }
        const objectHandle = await this.initiateCaptureAndWaitForObjectHandle()
        // The shutter has fired: a failure from here on leaves a photo that may exist, never a retry.
        return afterShutterRelease(async () => {
            let info: ObjectInfo | undefined
            let data: Uint8Array | undefined
            if (includeInfo) {
                const response = await this.send(this.registry.operations.GetObjectInfo, { ObjectHandle: objectHandle })
                if (response.code !== OK.code)
                    throw new PTPResponseError(response.code, undefined, { operation: 'GetObjectInfo' })
                info = response.data
            }
            if (includeData) {
                const response = await this.send(
                    this.registry.operations.GetObject,
                    { ObjectHandle: objectHandle },
                    undefined,
                    (info?.objectCompressedSize || this.liveViewBufferSize) + this.bufferPadding
                )
                if (response.code !== OK.code) throw new PTPResponseError(response.code, undefined, { operation: 'GetObject' })
                data = response.data
            }
            return { info, data, objectHandle }
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
                    { ObjectHandle: objectHandle, Offset: offset, MaxBytes: bytesToRead },
                    undefined,
                    bytesToRead + 12
                )
                if (response.code !== OK.code)
                    throw new PTPResponseError(response.code, `GetPartialObject returned 0x${response.code.toString(16)}`)
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
            this.logger.completeTransfer(objectHandle, error instanceof PTPResponseError ? error.code : IncompleteTransfer.code)
            throw error
        }
    }

    public resolveCodec<T>(codec: CodecDefinition<T> | CodecDefinition<any>): CodecInstance<T> {
        return typeof codec === 'function' ? codec(this.registry) : codec
    }

    protected async waitMs(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    protected handleEvent(event: PTPEvent): void {
        const eventDef = Object.values(this.registry.events).find(e => e.code === event.code) as
            EventDefinition | undefined
        if (!eventDef) return
        const decodedParams: Record<string, number | bigint | string> = {}
        const encodedParams = event.parameters || []
        eventDef.parameters.forEach((paramDef, index) => {
            const rawValue = encodedParams[index]
            if (!paramDef || index >= encodedParams.length) return
            const codec = this.resolveCodec(paramDef.codec)
            decodedParams[paramDef.name] =
                typeof rawValue === 'number' || typeof rawValue === 'bigint' || typeof rawValue === 'string'
                    ? codec.decode(codec.encode(rawValue)).value
                    : rawValue
        })
        if (typeof decodedParams.PropertyCode === 'number') {
            const property = this.propertyByCode(decodedParams.PropertyCode)
            if (property) decodedParams.PropertyName = property.name
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
            const timedOut = new Error(`Timed out after ${timeoutMilliseconds}ms waiting for the captured image object`)
            const timeout = setTimeout(() => fail(shutterOutcomeUnknown(timedOut)), timeoutMilliseconds)
            this.on(objectAdded, handleObjectAdded)
            void this.send(this.registry.operations.InitiateCapture, {})
                .then(({ code }) => {
                    if (code !== OK.code)
                        fail(shutterRefused(new PTPResponseError(code, `InitiateCapture returned 0x${code.toString(16)}`)))
                })
                .catch(error => fail(shutterOutcomeUnknown(error)))
        })
    }

    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) >>> 0
        if (this.transactionId === 0) this.transactionId = 1
        return this.transactionId
    }

    protected getCurrentTransactionId(): number {
        return this.transactionId
    }

    /** A PTP container: length, type, code and transaction ID, then the payload. */
    /** Response (and response-as-data) containers carry up to five UINT32 parameters; vendor commands report status there. */
    private decodeResponseParameters(payload: Uint8Array): number[] | undefined {
        if (payload.length === 0 || payload.length % 4 !== 0) return undefined
        return Array.from({ length: payload.length / 4 }, (_, index) => this.registry.codecs.uint32.decode(payload, index * 4).value)
    }

    /** @internal The Camera this driver serves, set when Camera creates the driver; a standalone driver has none. */
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
        return (this.#mediaGroup ??= ptpMediaCapability(this))
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
            const vendor = vendorEntry(this.vendorId)
            const lensMount = vendor?.lensMount?.(model.trim())
            const info: CameraInfo = {
                manufacturer: vendor?.make || manufacturer.trim(),
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

    /** What the transport says it is, else USB or PTP/IP by its type. */
    private connectionKind(): CameraInfo['connection'] {
        return this.transport.connectionKind?.() ?? (this.transport.getType() === TransportType.USB ? 'usb' : 'ip')
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
        return writeCameraControl(this, id, value, context)
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

    /**
     * Whether the camera can record to one of its cards. PTP AccessCapability describes host access
     * only: 0 is read/write. A brand whose card status says more overrides this, and may add evidence.
     */
    async storageCanRecord(_storageId: number, accessCapability: number): Promise<StorageRecording> {
        return { writable: accessCapability === 0 }
    }

    /** The battery as the body reports it: the standard BatteryLevel, unless a brand reads more. */
    async readPower(): Promise<CameraPower | undefined> {
        return readStandardPower(this)
    }

    async getBattery(): Promise<Battery> {
        return reportingRefusals('getBattery', async () => batteryFromPower(await this.readPower()))
    }

    /** The standard DateTime property; Sony overrides this with its Date/Time Setting. */
    async setClock(moment: Date): Promise<void> {
        return reportingRefusals('setClock', () => setStandardClock(this, moment))
    }

    subscribe(event: CameraEventName, handler: CameraEventHandler): () => void {
        return emittedEvents(this, event, handler)
    }

    /**
     * What a body on these standard paths can do, from what its DeviceInfo advertises. A brand's
     * own takePhoto sends its own operations, so only the standard InitiateCapture release is judged here.
     */
    async availability(
        operation: CameraOperationName,
        capabilities: CameraCapabilities
    ): Promise<OperationAvailability | undefined> {
        if (operation === 'getCardStatus' || operation === 'listMedia' || operation === 'getMediaPreview' || operation === 'downloadMedia')
            return (await (await this.mediaGroup()).availability?.(capabilities))?.[operation]
        if (operation === 'takePhoto' && this.takePhoto === GenericCamera.prototype.takePhoto) {
            const { operationsAdvertised } = await import('@vendors/generic/generic-operations')
            return operationsAdvertised(capabilities, [this.registry.operations.InitiateCapture])
        }
        if (operation !== 'setClock') return undefined
        if (this.#clockCheck?.sessionId !== this.sessionId)
            this.#clockCheck = {
                sessionId: this.sessionId,
                reason: await reportingRefusals('setClock', () => standardClockUnavailable(this)),
            }
        return this.#clockCheck.reason ? { supported: false, reason: this.#clockCheck.reason } : undefined
    }
}

/** Event names, across the standard and vendor registries, that mean each public event. */
const EVENT_DEFINITION_NAMES: Record<CameraEventName, readonly string[]> = {
    settingsChanged: ['DevicePropChanged', 'SDIE_DevicePropChanged'],
    mediaAdded: ['ObjectAdded', 'SDIE_ObjectAdded'],
}

/** Events the driver emits as they arrive: the USB interrupt pipe, or Canon's own event loop. */
function emittedEvents(driver: GenericCamera, event: CameraEventName, handler: CameraEventHandler): () => void {
    const events: Record<string, EventDefinition> = driver.registry.events
    const definitions = Object.values(events).filter(definition => EVENT_DEFINITION_NAMES[event].includes(definition.name))
    const listener = () => handler()
    for (const definition of definitions) driver.on(definition, listener)
    return () => {
        for (const definition of definitions) driver.off(definition, listener)
    }
}
