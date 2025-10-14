/**
 * GenericCamera - Approach 6 Implementation
 *
 * This is a refactored version that accepts definition objects instead of strings.
 * All runtime functionality is preserved from the original implementation.
 */

import { EventEmitter } from '@ptp/types/event'
import type { EventData } from '@ptp/types/event'
import { createPTPRegistry, Registry, type PTPRegistry } from '@ptp/registry'
import type { CodecType, CodecDefinition, CodecInstance } from '@ptp/types/codec'
import { TransportInterface, PTPEvent } from '@transport/interfaces/transport.interface'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { ParameterDefinition } from '@ptp/types/parameter'
import { Logger, PTPTransferLog } from '@core/logger'
import { OperationParams, OperationResponse } from '@ptp/types/type-helpers'

// ============================================================================
// GenericCamera class
// ============================================================================

export class GenericCamera {
    protected emitter = new EventEmitter()
    public sessionId: number | null = null
    public vendorId: number | null = null
    private transactionId = 0
    public transport: TransportInterface
    protected logger: Logger
    protected registry: Registry

    constructor(transport: TransportInterface, logger: Logger) {
        this.transport = transport
        this.logger = logger
        this.registry = createPTPRegistry(transport.isLittleEndian())

        if (this.transport.on) {
            this.transport.on(this.handleEvent.bind(this))
        }
    }

    /**
     * Connect to device and open session
     */
    async connect(deviceIdentifier?: DeviceDescriptor): Promise<void> {
        await this.transport.connect({ ...deviceIdentifier, ...(this.vendorId && { vendorId: this.vendorId }) })

        this.sessionId = Math.floor(Math.random() * 0xffffffff)
        const openResult = await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })

        // Handle session already open error
        if (openResult.code === 0x201e) {
            await this.send(this.registry.operations.CloseSession, {})
            await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        }
    }

    /**
     * Disconnect from device and close session
     */
    async disconnect(): Promise<void> {
        this.emitter.removeAllListeners()

        if (this.sessionId !== null) {
            await this.send(this.registry.operations.CloseSession, {})
        }

        this.sessionId = null
        await this.transport.disconnect()
    }

    /**
     * Send operation with automatic type inference from definition
     * Handles both public API and internal use (connect/disconnect/get/set)
     * Accepts any OperationDefinition to allow vendor cameras to use their extended operations
     */
    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        const transactionId = this.getNextTransactionId()

        const encodedParams: Uint8Array[] = []
        const paramsRecord: Record<string, number | bigint | string> = params

        // Encode operation parameters
        for (const paramDef of operation.operationParameters) {
            if (!paramDef) continue

            let value = paramsRecord[paramDef.name]

            // Use default value if parameter is undefined and has a default
            if (value === undefined && 'defaultValue' in paramDef && paramDef.defaultValue !== undefined) {
                value = paramDef.defaultValue
            }

            // Skip optional parameters without defaults if undefined
            if (value === undefined && !paramDef.required) continue

            if (value === undefined && paramDef.required) {
                throw new Error(`Required parameter ${paramDef.name} missing`)
            }

            const codec = this.resolveCodec(paramDef.codec)
            encodedParams.push(codec.encode(value))
        }

        // Check if this is a partial object operation (for transfer logging)
        const isPartialObjectOp = operation.name.includes('Partial')
        const objectHandleValue = isPartialObjectOp ? paramsRecord.ObjectHandle : null
        const objectHandle: number | null = typeof objectHandleValue === 'number' ? objectHandleValue : null

        // Create or reuse transfer log for partial object operations
        let logId: number
        if (isPartialObjectOp && objectHandle !== null) {
            const existingLogId = this.logger.getActiveTransfer(objectHandle)
            if (existingLogId !== undefined) {
                logId = existingLogId
            } else {
                const transferLog: Omit<PTPTransferLog, 'id' | 'timestamp'> = {
                    type: 'ptp_transfer',
                    level: 'info',
                    sessionId: this.sessionId!,
                    transactionId,
                    objectHandle,
                    totalBytes: 0,
                    transferredBytes: 0,
                    chunks: [],
                    requestPhase: {
                        timestamp: Date.now(),
                        operationName: operation.name,
                        encodedParams,
                        decodedParams: paramsRecord,
                    },
                }
                logId = this.logger.addLog(transferLog)
                this.logger.registerTransfer(objectHandle, logId)
            }
        } else {
            // Regular operation - create standard log
            logId = this.logger.addLog({
                type: 'ptp_operation',
                level: 'info',
                sessionId: this.sessionId!,
                transactionId,
                requestPhase: {
                    timestamp: Date.now(),
                    operationName: operation.name,
                    encodedParams,
                    decodedParams: paramsRecord,
                },
            })
        }

        // Build and send COMMAND container
        const commandContainer = this.buildCommand(operation.code, transactionId, encodedParams)
        await this.transport.send(commandContainer, this.sessionId!, transactionId)

        // Handle data phase
        let receivedData: Uint8Array | undefined
        if (operation.dataDirection === 'in') {
            // Send DATA to camera
            if (!data) throw new Error('Data required for dataDirection=in')
            const dataContainer = this.buildData(operation.code, transactionId, data)

            this.logger.updateLog(logId, {
                dataPhase: {
                    timestamp: Date.now(),
                    direction: 'in',
                    bytes: data.length,
                    encodedData: data,
                    maxDataLength,
                },
            })

            await this.transport.send(dataContainer, this.sessionId!, transactionId)
        } else if (operation.dataDirection === 'out') {
            // Receive DATA from camera
            const bufferSize = maxDataLength || 256 * 1024
            const dataRaw = await this.transport.receive(bufferSize, this.sessionId!, transactionId)
            const dataContainer = this.parseContainer(dataRaw)
            receivedData = dataContainer.payload

            // Decode received data if dataCodec is defined
            let decodedData: number | bigint | string | object | Uint8Array | undefined = undefined
            if (receivedData && receivedData.length > 0 && 'dataCodec' in operation && operation.dataCodec) {
                const codec = this.resolveCodec(operation.dataCodec)
                const result = codec.decode(receivedData)
                decodedData = result.value
            }

            // Special handling for property value operations without dataCodec
            if (receivedData && receivedData.length > 0 && !decodedData && operation.name.includes('GetDevicePropValue')) {
                const propCode = paramsRecord.DevicePropCode
                if (propCode !== undefined) {
                    // Look up property definition in registry to decode value
                    const property = Object.values(this.registry.properties).find(
                        (p: any) => p.code === propCode
                    ) as any
                    if (property) {
                        const codec = this.resolveCodec(property.codec)
                        const result = codec.decode(receivedData)
                        decodedData = {
                            propertyName: property.name,
                            propertyCode: propCode,
                            value: result.value,
                        }
                    }
                }
            }

            // Handle data phase logging
            if (isPartialObjectOp && typeof objectHandle === 'number') {
                // For partial object operations, add chunk info to transfer log
                const offsetValue =
                    typeof paramsRecord.Offset === 'number'
                        ? paramsRecord.Offset
                        : typeof paramsRecord.OffsetLower === 'number'
                          ? paramsRecord.OffsetLower
                          : 0
                const offsetUpperValue = typeof paramsRecord.OffsetUpper === 'number' ? paramsRecord.OffsetUpper : 0
                const fullOffset = offsetUpperValue * 0x100000000 + offsetValue
                const receivedBytes = receivedData?.length || 0

                const currentLog = this.logger.getLogById(logId)
                const isTransferLog = currentLog && currentLog.type === 'ptp_transfer'
                const chunks = isTransferLog ? [...currentLog.chunks] : []

                chunks.push({
                    transactionId,
                    timestamp: Date.now(),
                    offset: fullOffset,
                    bytes: receivedBytes,
                })

                const totalTransferred = chunks.reduce((sum, c) => sum + c.bytes, 0)
                const totalBytes =
                    isTransferLog && currentLog.totalBytes > 0
                        ? currentLog.totalBytes
                        : maxDataLength || fullOffset + receivedBytes

                this.logger.updateLog(logId, {
                    chunks,
                    totalBytes,
                    transferredBytes: totalTransferred,
                    dataPhase: {
                        timestamp: Date.now(),
                        direction: 'out',
                        bytes: receivedData?.length || 0,
                        encodedData: receivedData,
                        decodedData: decodedData,
                        maxDataLength,
                    },
                })
            } else {
                // Regular operation - standard data phase
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

        // Receive RESPONSE
        const responseRaw = await this.transport.receive(512, this.sessionId!, transactionId)
        const responseContainer = this.parseContainer(responseRaw)

        this.logger.updateLog(logId, {
            responsePhase: {
                timestamp: Date.now(),
                code: responseContainer.code,
            },
        })

        // Return decoded data if available, but for property operations return raw bytes
        const isPropertyOp = operation.name.includes('GetDevicePropValue')
        const finalData = this.logger.getLogs().find(l => l.id === logId)
        const returnData =
            !isPropertyOp &&
            finalData &&
            finalData.type === 'ptp_operation' &&
            finalData.dataPhase?.decodedData !== undefined
                ? finalData.dataPhase.decodedData
                : receivedData

        return {
            code: responseContainer.code,
            data: returnData,
        } as OperationResponse<Op>
    }

    /**
     * Get property with automatic type inference from definition
     * Returns the full property descriptor decoded by GetDevicePropDesc
     * Can be overridden by subclasses to use vendor-specific operations
     */
    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        // Use GetDevicePropDesc to get full descriptor including current value
        const response = await this.send(this.registry.operations.GetDevicePropDesc as any, {
            DevicePropCode: property.code,
        })

        if (!('data' in response) || !response.data) {
            throw new Error('No data received from GetDevicePropDesc')
        }

        // Cast needed: TypeScript knows data exists but can't narrow to specific property's codec type
        return response.data as CodecType<P['codec']>
    }

    /**
     * Set property with automatic type inference from definition
     * Can be overridden by subclasses to use vendor-specific operations
     */
    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        if (!property.access.includes('Set')) {
            throw new Error(`Property ${property.name} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)

        await this.send(this.registry.operations.SetDevicePropValue, { DevicePropCode: property.code }, encodedValue)
    }

    /**
     * Register event listener
     */
    on(eventName: string, handler: (event: EventData) => void): void {
        this.emitter.on(eventName, handler)
    }

    /**
     * Unregister event listener
     */
    off(eventName: string, handler?: (event: EventData) => void): void {
        if (handler) {
            this.emitter.off(eventName, handler)
        } else {
            this.emitter.removeAllListeners(eventName)
        }
    }

    /**
     * Handle incoming PTP events from transport
     */
    protected handleEvent(event: PTPEvent): void {
        // Look up event definition by code
        const eventDef = Object.values(this.registry.events).find((e: any) => e.code === event.code) as any
        if (!eventDef) return

        // Emit event parameters as array (compatible with EventData)
        this.emitter.emit(eventDef.name, event.parameters)
    }

    /**
     * Get next transaction ID (wraps at 32-bit boundary)
     */
    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) & 0xffffffff
        if (this.transactionId === 0) this.transactionId = 1
        return this.transactionId
    }

    /**
     * Build PTP COMMAND container
     */
    private buildCommand(code: number, transactionId: number, params: Uint8Array[]): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        const paramBytes = params.reduce((sum, p) => sum + p.length, 0)
        const length = 12 + paramBytes

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(1), // COMMAND type
            u16.encode(code),
            u32.encode(transactionId),
            ...params,
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    /**
     * Build PTP DATA container
     */
    private buildData(code: number, transactionId: number, data: Uint8Array): Uint8Array {
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        const length = 12 + data.length

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(2), // DATA type
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

    /**
     * Parse PTP container (COMMAND, DATA, or RESPONSE)
     */
    private parseContainer(data: Uint8Array): {
        type: number
        code: number
        transactionId: number
        payload: Uint8Array
    } {
        if (data.length < 12) {
            throw new Error(`Container too short: ${data.length} bytes`)
        }

        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        let offset = 0

        const lengthResult = u32.decode(data, offset)
        const length = lengthResult.value
        offset += lengthResult.bytesRead

        const typeResult = u16.decode(data, offset)
        const type = typeResult.value
        offset += typeResult.bytesRead

        const codeResult = u16.decode(data, offset)
        const code = codeResult.value
        offset += codeResult.bytesRead

        const transactionIdResult = u32.decode(data, offset)
        const transactionId = transactionIdResult.value
        offset += transactionIdResult.bytesRead

        const payload = data.slice(offset)

        return { type, code, transactionId, payload }
    }

    /**
     * Resolve codec definition to codec instance
     * Handles both codec instances and codec builder functions
     */
    public resolveCodec<T>(codec: CodecDefinition<T> | CodecDefinition<any>): CodecInstance<T> {
        // If it's a builder function, call it with full registry
        if (typeof codec === 'function') {
            return codec(this.registry)
        }

        // Otherwise it's already a codec instance
        return codec
    }
}
