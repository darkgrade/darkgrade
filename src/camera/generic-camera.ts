/**
 * PTP Protocol Implementation
 * Types are automatically inferred from definitions - true single source of truth
 */

import { EventEmitter } from '@ptp/types/event'
import {
    getOperationByName as getStandardOperationByName,
    operationDefinitions as standardOperationDefinitions,
} from '@ptp/definitions/operation-definitions'
import {
    getPropertyByName as getStandardPropertyByName,
    propertyDefinitions as standardPropertyDefinitions,
} from '@ptp/definitions/property-definitions'
import {
    getEventByName as getStandardEventByName,
    eventDefinitions as standardEventDefinitions,
} from '@ptp/definitions/event-definitions'
import { responseDefinitions as standardResponseDefinitions } from '@ptp/definitions/response-definitions'
import { formatDefinitions as standardFormatDefinitions } from '@ptp/definitions/format-definitions'
import { CodecType, baseCodecs, createBaseCodecs, BaseCodecType, CodecDefinition } from '@ptp/types/codec'
import { TransportInterface, PTPEvent } from '@transport/interfaces/transport.interface'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { OperationDefinition } from '@ptp/types/operation'
import { PropertyDefinition } from '@ptp/types/property'
import { ResponseDefinition } from '@ptp/types/response'
import { FormatDefinition } from '@ptp/types/format'
import { Logger } from '@core/logger'

// Helper to extract codec type from parameter definition
type ParamCodecType<P> = P extends { codec: infer C } ? CodecType<C> : never

// Helper to build parameter object from array
type BuildParamObject<Params extends readonly any[], Acc = {}> = Params extends readonly []
    ? Acc
    : Params extends readonly [infer Head, ...infer Tail]
      ? Head extends { name: infer N extends string; codec: infer C; required: true }
          ? BuildParamObject<Tail, Acc & Record<N, CodecType<C>>>
          : Head extends { name: infer N extends string; codec: infer C }
            ? BuildParamObject<Tail, Acc & Partial<Record<N, CodecType<C>>>>
            : BuildParamObject<Tail, Acc>
      : Acc

// Convert operation parameters to named object parameters
// Uses strict object type to catch invalid parameters at compile time
type OperationParamsObject<Op extends OperationDefinition> = Op['operationParameters'] extends readonly []
    ? Record<string, never> // No parameters allowed - strict empty object
    : BuildParamObject<Op['operationParameters']>

// Extract operation name from definition
type OperationName<Ops extends readonly OperationDefinition[]> = Ops[number]['name']

// Get operation by name
type GetOperation<N extends string, Ops extends readonly OperationDefinition[]> = Extract<Ops[number], { name: N }>

// Extract property name from definition
type PropertyName<Props extends readonly PropertyDefinition[]> = Props[number]['name']

// Get property by name
type GetProperty<N extends string, Props extends readonly PropertyDefinition[]> = Extract<Props[number], { name: N }>

// Extract property value type from codec
type PropertyValue<N extends string, Props extends readonly PropertyDefinition[]> =
    GetProperty<N, Props> extends { codec: infer C } ? CodecType<C> : never

// Extract operation data return type
type OperationDataType<Op extends OperationDefinition> =
    Op extends { dataCodec: infer C } ? CodecType<C> : never

// Build operation response type
type OperationResponse<Op extends OperationDefinition> =
    Op extends { dataCodec: any }
        ? { code: number; data: OperationDataType<Op> }
        : { code: number; data?: undefined }

// Runtime event data structure (not a definition, but actual event data)
interface PTPEventData {
    name: string
    code: number
    sessionId?: number
    transactionId?: number
    parameters: number[]
}

export class GenericCamera<
    Ops extends readonly OperationDefinition[] = typeof standardOperationDefinitions,
    Props extends readonly PropertyDefinition[] = typeof standardPropertyDefinitions,
    Resps extends readonly ResponseDefinition[] = typeof standardResponseDefinitions,
    Formats extends readonly FormatDefinition[] = typeof standardFormatDefinitions,
> {
    private emitter = new EventEmitter()
    public sessionId: number | null = null
    private transactionId = 0
    public transport: TransportInterface
    protected operationDefinitions: Ops
    protected propertyDefinitions: Props
    protected responseDefinitions: Resps
    protected formatDefinitions: Formats
    protected logger: Logger<Ops>
    protected baseCodecs: ReturnType<typeof createBaseCodecs>

    constructor(
        transport: TransportInterface,
        logger: Logger<Ops>,
        operationDefinitions: Ops = standardOperationDefinitions as any,
        propertyDefinitions: Props = standardPropertyDefinitions as any,
        responseDefinitions: Resps = standardResponseDefinitions as any,
        formatDefinitions: Formats = standardFormatDefinitions as any
    ) {
        this.transport = transport
        this.logger = logger
        this.operationDefinitions = operationDefinitions
        this.propertyDefinitions = propertyDefinitions
        this.responseDefinitions = responseDefinitions
        this.formatDefinitions = formatDefinitions
        this.baseCodecs = createBaseCodecs(transport.isLittleEndian())

        if (this.transport.onEvent) {
            this.transport.onEvent(this.handleEvent.bind(this))
        }
    }

    async connect(deviceIdentifier?: DeviceDescriptor): Promise<void> {
        await this.transport.connect(deviceIdentifier)
        this.sessionId = Math.floor(Math.random() * 0xffffffff)

        try {
            await (this.send as any)('OpenSession', { SessionID: this.sessionId })
        } catch (error: any) {
            if (error.message?.includes('SessionAlreadyOpen')) {
                await (this.send as any)('CloseSession', {})
                await (this.send as any)('OpenSession', { SessionID: this.sessionId })
            } else {
                throw error
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.sessionId !== null) {
            this.emitter.removeAllListeners()
            try {
                await (this.send as any)('CloseSession', {})
            } catch (e) {
                // Ignore close session errors during disconnect
            }
            this.sessionId = null
        }
        await this.transport.disconnect()
    }

    /**
     * Send operation with automatic type inference from definitions
     * Uses named parameters for clarity
     */
    async send<N extends OperationName<Ops>>(
        operationName: N,
        params: OperationParamsObject<GetOperation<N, Ops>>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<GetOperation<N, Ops>>> {
        const operation = this.operationDefinitions.find(op => op.name === operationName)
        if (!operation) {
            throw new Error(`Unknown operation: ${operationName}`)
        }

        const transactionId = this.getNextTransactionId()

        const encodedParams: Uint8Array[] = []
        for (const paramDef of operation.operationParameters) {
            if (!paramDef) continue

            let value = (params as any)[paramDef.name]

            // Use default value if parameter is undefined and has a default
            if (value === undefined && 'defaultValue' in paramDef) {
                value = (paramDef as any).defaultValue
            }

            // Skip optional parameters without defaults if undefined
            if (value === undefined && !paramDef.required) continue

            if (value === undefined && paramDef.required) {
                throw new Error(`Required parameter ${paramDef.name} missing`)
            }

            const codec = this.resolveCodec(paramDef.codec)
            encodedParams.push(codec.encode(value))
        }

        // Check if this is a partial object operation (GetPartialObject or SDIO_GetPartialLargeObject)
        const isPartialObjectOp = operationName === 'GetPartialObject' || operationName === 'SDIO_GetPartialLargeObject'
        const objectHandle = isPartialObjectOp ? (params as any).ObjectHandle : null

        // Check if we have an active transfer for this object
        let logId: number
        if (isPartialObjectOp && objectHandle !== null) {
            const existingLogId = this.logger.getActiveTransfer(objectHandle)
            if (existingLogId !== undefined) {
                // Reuse existing transfer log
                logId = existingLogId
            } else {
                // Create new transfer log
                logId = this.logger.addLog({
                    type: 'ptp_transfer',
                    level: 'info',
                    sessionId: this.sessionId!,
                    transactionId,
                    objectHandle: objectHandle!,
                    totalBytes: 0, // Will be updated later
                    transferredBytes: 0, // Will be updated later
                    chunks: [],
                    requestPhase: {
                        timestamp: Date.now(),
                        operationName: operationName as any,
                        encodedParams,
                        decodedParams: params as any,
                    },
                } as any)
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
                    operationName: operationName as any,
                    encodedParams,
                    decodedParams: params as any,
                },
            })
        }

        try {
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
                // Use custom maxDataLength if provided, otherwise default to 256KB for live view
                const bufferSize = maxDataLength || 256 * 1024
                const dataRaw = await this.transport.receive(bufferSize, this.sessionId!, transactionId)
                const dataContainer = this.parseContainer(dataRaw)
                receivedData = dataContainer.payload

                // Decode received data if dataCodec is defined
                let decodedData: any = undefined
                if (receivedData && (operation as any).dataCodec) {
                    try {
                        const codec = this.resolveCodec((operation as any).dataCodec)
                        const result = codec.decode(receivedData)
                        decodedData = result.value
                    } catch (decodeError) {
                        console.error(`Failed to decode ${operationName} data:`, decodeError)
                        console.error(`Received ${receivedData.length} bytes:`, Array.from(receivedData.slice(0, 64)).map(b => b.toString(16).padStart(2, '0')).join(' '))
                        throw decodeError
                    }
                }

                // Handle data phase logging
                if (isPartialObjectOp && objectHandle !== null) {
                    // For partial object operations, add chunk info to transfer log
                    const offset = (params as any).Offset ?? ((params as any).OffsetLower ?? 0)
                    const offsetUpper = (params as any).OffsetUpper ?? 0
                    const fullOffset = offsetUpper * 0x100000000 + offset
                    const receivedBytes = receivedData?.length || 0

                    // Get current log to update chunks
                    const currentLog = this.logger.getLogById(logId) as any
                    const chunks = currentLog?.chunks || []
                    chunks.push({
                        transactionId,
                        timestamp: Date.now(),
                        offset: fullOffset,
                        bytes: receivedBytes,
                    })

                    const totalTransferred = chunks.reduce((sum: number, c: any) => sum + c.bytes, 0)

                    // Only set totalBytes on first chunk (when current is 0) or if maxDataLength is provided
                    const totalBytes = currentLog?.totalBytes && currentLog.totalBytes > 0
                        ? currentLog.totalBytes  // Keep existing totalBytes
                        : (maxDataLength || (fullOffset + receivedBytes))  // Set initial totalBytes

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


            // Return decoded data if available
            const finalData = this.logger.getLogs().find(l => l.id === logId)
            const returnData = (finalData as any)?.dataPhase?.decodedData !== undefined
                ? (finalData as any).dataPhase.decodedData
                : receivedData

            return {
                code: responseContainer.code,
                data: returnData,
            } as OperationResponse<GetOperation<N, Ops>>
        } catch (error) {
            throw error
        }
    }

    /**
     * Get property with automatic type inference from definitions
     * NO MANUAL OVERLOADS - types come directly from property-definitions.ts
     */
    async get<N extends PropertyName<Props>>(propertyName: N): Promise<PropertyValue<N, Props>> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Get')) {
            throw new Error(`Property ${propertyName} is not readable`)
        }

        const response = await (this.send as any)('GetDevicePropValue', {
            DevicePropCode: property.code,
        })

        if (!response.data) {
            throw new Error('No data received from GetDevicePropValue')
        }

        const codec = this.resolveCodec(property.codec)
        const result = codec.decode(response.data)

        return result.value as PropertyValue<N, Props>
    }

    /**
     * Set property with automatic type inference from definitions
     */
    async set<N extends PropertyName<Props>>(propertyName: N, value: PropertyValue<N, Props>): Promise<void> {
        const property = this.propertyDefinitions.find(p => p.name === propertyName)
        if (!property) {
            throw new Error(`Unknown property: ${propertyName}`)
        }

        if (!property.access.includes('Set')) {
            throw new Error(`Property ${propertyName} is not writable`)
        }

        const codec = this.resolveCodec(property.codec)
        const encodedValue = codec.encode(value)
        const response = await (this.send as any)(
            'SetDevicePropValue',
            {
                DevicePropCode: property.code,
            },
            encodedValue
        )
    }

    on(eventName: string, handler: (event: PTPEventData) => void): void {
        this.emitter.on(eventName, handler)
    }

    off(eventName: string, handler?: (event: PTPEventData) => void): void {
        if (handler) {
            this.emitter.off(eventName, handler)
        } else {
            this.emitter.removeAllListeners(eventName)
        }
    }

    private handleEvent(event: PTPEvent): void {
        const eventDef = standardEventDefinitions.find(e => e.code === event.code)
        if (!eventDef) return

        const ptpEvent: PTPEventData = {
            name: eventDef.name,
            code: event.code,
            sessionId: this.sessionId ?? undefined,
            transactionId: event.transactionId,
            parameters: event.parameters,
        }

        this.emitter.emit(eventDef.name, ptpEvent)
    }

    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) & 0xffffffff
        if (this.transactionId === 0) this.transactionId = 1
        return this.transactionId
    }

    private buildCommand(code: number, transactionId: number, params: Uint8Array[]): Uint8Array {
        const u16 = this.resolveCodec(baseCodecs.uint16)
        const u32 = this.resolveCodec(baseCodecs.uint32)

        const paramBytes = params.reduce((sum, p) => sum + p.length, 0)
        const length = 12 + paramBytes

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(1), // COMMAND type
            u16.encode(code),
            u32.encode(transactionId),
            ...params
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
        const u16 = this.resolveCodec(baseCodecs.uint16)
        const u32 = this.resolveCodec(baseCodecs.uint32)

        const length = 12 + data.length

        const parts: Uint8Array[] = [
            u32.encode(length),
            u16.encode(2), // DATA type
            u16.encode(code),
            u32.encode(transactionId),
            data
        ]

        const buffer = new Uint8Array(length)
        let offset = 0
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }

        return buffer
    }

    private parseContainer(data: Uint8Array): {
        type: number
        code: number
        transactionId: number
        payload: Uint8Array
    } {
        if (data.length < 12) {
            throw new Error(`Container too short: ${data.length} bytes`)
        }

        const u16 = this.resolveCodec(baseCodecs.uint16)
        const u32 = this.resolveCodec(baseCodecs.uint32)

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

    public resolveCodec<T>(codec: CodecDefinition<T>): {
        encode: (value: T) => Uint8Array
        decode: (buffer: Uint8Array, offset?: number) => { value: T; bytesRead: number }
    } {
        if ('encode' in codec && codec.encode && 'decode' in codec && codec.decode) {
            const anyCodec = codec as any

            if (!anyCodec.baseCodecs) {
                anyCodec.baseCodecs = this.baseCodecs
            }

            return codec as any
        }

        const standardType = codec.type as BaseCodecType
        const impl = this.baseCodecs[standardType as keyof typeof this.baseCodecs]
        if (!impl) {
            throw new Error(`Unknown standard codec type: ${standardType}`)
        }
        return impl as any
    }
}

// Export types for external use
export type { PTPEventData, OperationName, PropertyName, PropertyValue, OperationParamsObject, GetOperation }
