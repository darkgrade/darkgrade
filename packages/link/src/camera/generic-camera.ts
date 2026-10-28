import { CONTAINER_TYPE, TransactionChannel, type TransactionPolicy } from '@camera/transaction-channel'
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
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import { DeviceBusy, OK, SessionAlreadyOpen } from '@ptp/definitions/response-definitions'
import { randomSessionId } from '@ptp/definitions/session'
import { createPTPRegistry, Registry } from '@ptp/registry'
import type { CodecDefinition, CodecInstance, CodecType } from '@ptp/types/codec'
import { EventDefinition, EventEmitter } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'

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
    public transport: TransportInterface
    protected logger: Logger
    public registry: Registry

    protected liveViewBufferSize = 5 * 1024 * 1024 // 5MB
    protected captureBufferSize = 100 * 1024 * 1024 // 100MB
    protected bufferPadding = 1024 * 1024 // 1MB
    protected defaultChunkSize = 10 * 1024 * 1024 // 10MB

    constructor(transport: TransportInterface, logger: Logger) {
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
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.recovery?.status === 'pending')
            throw new PTPRecoveryRequiredError('Transport recovery is still running', this.lastFailure)
        if (!this.transport.isConnected()) {
            await this.transport.connect(device)
            this.channel.newConnection()
            this.needsResynchronization = false
            this.lastFailure = undefined
            this.recovery = undefined
        } else await this.resynchronizeIfNeeded()

        this.sessionId = randomSessionId()
        try {
            let openResult = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
            if (openResult.code === SessionAlreadyOpen.code) {
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

        return result
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

        const { deviceBusyRetries, deviceBusyBackoffMilliseconds } = this.channel.policy
        const retriesDeviceBusy = operation.code >= STANDARD_OPERATIONS.from && operation.code <= STANDARD_OPERATIONS.to
        for (let attempt = 0; ; attempt++) {
            const response = await this.runTransaction(operation, paramsRecord, encodedParams, data, maxDataLength)
            if (response.code !== DeviceBusy.code || !retriesDeviceBusy || attempt >= deviceBusyRetries) {
                return response
            }
            await this.waitMs(
                Math.min(this.channel.policy.timeoutMilliseconds, deviceBusyBackoffMilliseconds * 2 ** attempt)
            )
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
        const sessionId = randomSessionId()
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
            return await this.exchange(
                operation,
                paramsRecord,
                encodedParams,
                transactionId,
                sessionId,
                data,
                maxDataLength
            )
        } catch (error) {
            if (error instanceof PTPTimeoutError || error instanceof PTPProtocolError) {
                this.needsResynchronization = true
                this.lastFailure = { operation: operation.name, transactionId, cause: error }
            }
            // Transport errors keep their own type; a transport that went away also ended the session.
            if (!this.transport.isConnected()) this.sessionId = null
            throw error
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
        const finalData = logId !== -1 ? this.logger.getLogs().find(l => l.id === logId) : undefined
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
            parameters: responseContainer.type === 3
                ? this.decodeResponseParameters(responseContainer.payload)
                : undefined,
            data: returnData,
        } as OperationResponse<Op>
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const response = await this.send(this.registry.operations.GetDevicePropDesc, {
            DevicePropCode: property.code,
        })

        if (!('data' in response) || !response.data) {
            throw new Error('No data received from GetDevicePropDesc')
        }

        // DevicePropDesc uses the registered property codec for the decoded current value.
        return response.data.currentValueDecoded as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        const response = await this.send(
            this.registry.operations.SetDevicePropValue,
            { DevicePropCode: property.code },
            encodedValue
        )
        if (response.code !== OK.code) throw new Error(`SetDevicePropValue returned 0x${response.code.toString(16)}`)
    }

    async getStandardPropertyStates(): Promise<StandardPropertyState[]> {
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

            try {
                const response = await this.send(this.registry.operations.GetDevicePropDesc, { DevicePropCode: code })
                if (!response.data) continue
                states.push(this.standardPropertyState(response.data))
            } catch (error) {
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
        const states = await this.getStandardPropertyStates()
        const requestedName = String(propertyNameOrCode).toLowerCase()
        const state = states.find(candidate =>
            typeof propertyNameOrCode === 'number'
                ? candidate.code === propertyNameOrCode
                : candidate.name.toLowerCase() === requestedName || candidate.codeHex.toLowerCase() === requestedName
        )
        if (!state) throw new Error(`The attached camera does not advertise ${propertyNameOrCode}`)
        if (!state.writable) throw new Error(`${state.name} is read-only on the attached camera`)

        const property = Object.values(this.registry.properties).find(candidate => candidate.code === state.code)
        if (!property) throw new Error(`${state.codeHex} has no standard PTP property definition`)

        let value: number | bigint | string = requestedValue
        if (state.allowedValues?.length) {
            const matched = state.allowedValues.find(candidate => String(candidate) === String(requestedValue))
            if (matched === undefined) {
                throw new Error(
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
        return {
            code: descriptor.devicePropertyCode,
            codeHex: `0x${descriptor.devicePropertyCode.toString(16).padStart(4, '0')}`,
            name: descriptor.devicePropertyName,
            description: descriptor.devicePropertyDescription,
            value: descriptor.currentValueDecoded,
            rawValue: descriptor.currentValueRaw,
            writable: descriptor.getSet === 'GET_SET',
            form: descriptor.formFlag === 0x02 ? 'enum' : descriptor.formFlag === 0x01 ? 'range' : 'none',
            ...(descriptor.supportedValuesDecoded ? { allowedValues: descriptor.supportedValuesDecoded } : {}),
            ...(descriptor.minimumValue !== undefined ? { minimumValue: descriptor.minimumValue } : {}),
            ...(descriptor.maximumValue !== undefined ? { maximumValue: descriptor.maximumValue } : {}),
            ...(descriptor.stepSize !== undefined ? { stepSize: descriptor.stepSize } : {}),
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

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
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

        let info: ObjectInfo | undefined = undefined
        let data: Uint8Array | undefined = undefined

        if (includeInfo) {
            const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                ObjectHandle: capturedImageObjectHandle,
            })
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
            data = objectResponse.data
        }

        return {
            info: info,
            data: data,
        }
    }

    async captureLiveView(_options: { includeInfo?: boolean; includeData?: boolean } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        throw new Error('Live view capture not supported on generic PTP cameras')
    }

    async startRecording(): Promise<void> {
        throw new Error('Video recording not supported on generic PTP cameras')
    }

    async stopRecording(): Promise<void> {
        throw new Error('Video recording not supported on generic PTP cameras')
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
        const storageIds = storageIdsResponse.data

        for (const storageId of storageIds) {
            // Get info for this storage
            const storageInfoResponse = await this.send(this.registry.operations.GetStorageInfo, {
                StorageID: storageId,
            })
            const storageInfo = storageInfoResponse.data

            // Prepare container for objects in this storage
            const storageObjects: { [objectHandle: number]: ObjectInfo } = {}

            // Get all object handles for this storage
            const objectIdsResponse = await this.send(this.registry.operations.GetObjectHandles, {
                StorageID: storageId,
            })
            const objectHandles = objectIdsResponse.data

            // Get detailed info for each object handle
            for (const objectHandle of objectHandles) {
                const objectInfoResponse = await this.send(this.registry.operations.GetObjectInfo, {
                    ObjectHandle: objectHandle,
                })
                storageObjects[objectHandle] = objectInfoResponse.data
            }

            result[storageId] = {
                info: storageInfo,
                objects: storageObjects,
            }
        }

        return result
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(objectSize) || objectSize < 0)
            throw new Error('Object size must be a nonnegative safe integer')
        // Start transfer tracking
        this.logger.startTransfer(objectHandle, this.sessionId!, 0, 'GetPartialObject', objectSize)

        const chunks: Uint8Array[] = []
        let offset = 0

        while (offset < objectSize) {
            const bytesToRead = Math.min(this.defaultChunkSize, objectSize - offset)

            const chunkResponse = await this.send(
                this.registry.operations.GetPartialObject,
                {
                    ObjectHandle: objectHandle,
                    Offset: offset,
                    MaxBytes: bytesToRead,
                },
                undefined,
                bytesToRead + 12
            )

            if (chunkResponse.code !== OK.code)
                throw new Error(`GetPartialObject returned 0x${chunkResponse.code.toString(16)}`)
            if (!chunkResponse.data?.length || chunkResponse.data.length > bytesToRead)
                throw new Error('GetPartialObject returned an empty or oversized chunk')

            // Update transfer progress
            this.logger.updateTransferProgress(objectHandle, chunkResponse.data.length, this.getCurrentTransactionId())

            chunks.push(chunkResponse.data)
            offset += chunkResponse.data.length
        }

        // Complete transfer tracking
        this.logger.completeTransfer(objectHandle)

        // Combine all chunks
        const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const completeFile = new Uint8Array(totalBytes)
        let writeOffset = 0
        for (const chunk of chunks) {
            completeFile.set(chunk, writeOffset)
            writeOffset += chunk.length
        }

        return completeFile
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

    protected initiateCaptureAndWaitForObjectHandle(timeoutMilliseconds = 15_000): Promise<number> {
        return new Promise((resolve, reject) => {
            const objectAdded = this.registry.events.ObjectAdded
            const cleanup = () => {
                clearTimeout(timeout)
                this.off(objectAdded, handleObjectAdded)
            }
            const fail = (error: unknown) => {
                cleanup()
                reject(error instanceof Error ? error : new Error(String(error)))
            }
            const handleObjectAdded = (event: { ObjectHandle?: number }) => {
                if (!event.ObjectHandle) return
                cleanup()
                resolve(event.ObjectHandle)
            }
            const timeout = setTimeout(
                () => fail(new Error(`Timed out after ${timeoutMilliseconds}ms waiting for the captured image object`)),
                timeoutMilliseconds
            )

            this.on(objectAdded, handleObjectAdded)
            void this.send(this.registry.operations.InitiateCapture, {})
                .then(response => {
                    if (response.code !== OK.code) {
                        fail(
                            new PTPResponseError(
                                response.code,
                                `InitiateCapture returned 0x${response.code.toString(16)}`
                            )
                        )
                    }
                })
                .catch(fail)
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
}
