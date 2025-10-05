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
import { LoggerInterface } from '@transport/usb/logger'

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
    protected logger: LoggerInterface
    protected baseCodecs: ReturnType<typeof createBaseCodecs>

    constructor(
        transport: TransportInterface,
        logger: LoggerInterface,
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
                this.logger.addLog({
                    type: 'warning',
                    message: 'Session already open, closing and retrying',
                    status: 'pending',
                    source: 'PTP',
                })
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
    ): Promise<{ code: number; data?: Uint8Array }> {
        const operation = this.operationDefinitions.find(op => op.name === operationName)
        if (!operation) {
            throw new Error(`Unknown operation: ${operationName}`)
        }

        const logId = this.logger.addLog({
            type: 'ptp_operation',
            operation: operationName,
            parameters: params as Record<string, any>,
            message: 'Calling',
            status: 'pending',
        })

        try {
            const encodedParams: Uint8Array[] = []
            for (const paramDef of operation.operationParameters) {
                if (!paramDef) continue

                const value = (params as any)[paramDef.name]
                if (value === undefined && !paramDef.required) continue
                if (value === undefined && paramDef.required) {
                    throw new Error(`Required parameter ${paramDef.name} missing`)
                }

                if (value !== undefined) {
                    const codec = this.resolveCodec(paramDef.codec)
                    encodedParams.push(codec.encode(value))
                }
            }

            // Build and send COMMAND container
            const transactionId = this.getNextTransactionId()
            const commandContainer = this.buildCommand(operation.code, transactionId, encodedParams)

            // Log command details for debugging
            this.logger.addLog({
                type: 'info',
                message: `Command params: ${encodedParams.map((p, i) => `P${i+1}=[${Array.from(p).map(b => b.toString(16).padStart(2, '0')).join(' ')}]`).join(', ')}`,
                status: 'succeeded',
                source: 'CAM',
            })

            await this.transport.send(commandContainer)

            // Handle data phase
            let receivedData: Uint8Array | undefined
            if (operation.dataDirection === 'in') {
                // Send DATA to camera
                if (!data) throw new Error('Data required for dataDirection=in')
                const dataContainer = this.buildData(operation.code, transactionId, data)
                await this.transport.send(dataContainer)
            } else if (operation.dataDirection === 'out') {
                // Receive DATA from camera
                // Use custom maxDataLength if provided, otherwise default to 256KB for live view
                const bufferSize = maxDataLength || 256 * 1024
                const dataRaw = await this.transport.receive(bufferSize)
                const dataContainer = this.parseContainer(dataRaw)
                receivedData = dataContainer.payload
            }

            // Receive RESPONSE
            const responseRaw = await this.transport.receive(512)
            const responseContainer = this.parseContainer(responseRaw)

            const responseDef = this.responseDefinitions.find(r => r.code === responseContainer.code)
            const responseStr = responseDef
                ? `${responseDef.name} (0x${responseContainer.code.toString(16)})`
                : `0x${responseContainer.code.toString(16)}`

            this.logger.updateEntry(logId, {
                status: responseContainer.code === 0x2001 ? 'succeeded' : 'failed',
                message: `Called → ${responseStr}`,
            })

            if (responseContainer.code !== 0x2001) {
                this.logger.updateEntry(logId, {
                    status: 'failed',
                    message: `Failed with error: ${responseDef?.name}: ${responseDef?.description}`,
                })
            }

            return {
                code: responseContainer.code,
                data: receivedData,
            }
        } catch (error) {
            this.logger.updateEntry(logId, {
                status: 'failed',
                message: `Failed with error: ${error}`,
            })
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

        const logId = this.logger.addLog({
            type: 'ptp_property_get',
            property: propertyName,
            message: 'Getting',
            status: 'pending',
        })

        try {
            const response = await (this.send as any)('GetDevicePropValue', {
                DevicePropCode: property.code,
            })

            const responseDef = this.responseDefinitions.find(r => r.code === response.code)
            const responseStr = responseDef
                ? `${responseDef.name} (0x${response.code.toString(16)})`
                : `0x${response.code.toString(16)}`

            this.logger.updateEntry(logId, {
                status: response.code === 0x2001 ? 'succeeded' : 'failed',
                message: `Got → ${responseStr}`,
            })

            if (response.code !== 0x2001) {
                const errorMsg = responseDef
                    ? `${responseDef.name}: ${responseDef.description}`
                    : `Unknown response code: 0x${response.code.toString(16)}`
                throw new Error(errorMsg)
            }

            if (!response.data) {
                throw new Error('No data received from GetDevicePropValue')
            }

            const codec = this.resolveCodec(property.codec)
            const result = codec.decode(response.data)

            return result.value as PropertyValue<N, Props>
        } catch (error) {
            this.logger.updateEntry(logId, {
                status: 'failed',
                message: 'Failed to get',
            })
            throw error
        }
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

        const logId = this.logger.addLog({
            type: 'ptp_property_set',
            property: propertyName,
            value,
            message: 'Setting',
            status: 'pending',
        })

        try {
            const codec = this.resolveCodec(property.codec)
            const encodedValue = codec.encode(value)
            const response = await (this.send as any)(
                'SetDevicePropValue',
                {
                    DevicePropCode: property.code,
                },
                encodedValue
            )

            const responseDef = this.responseDefinitions.find(r => r.code === response.code)
            const responseStr = responseDef
                ? `${responseDef.name} (0x${response.code.toString(16)})`
                : `0x${response.code.toString(16)}`

            this.logger.updateEntry(logId, {
                status: response.code === 0x2001 ? 'succeeded' : 'failed',
                message: `Set → ${responseStr}`,
            })

            if (response.code !== 0x2001) {
                const errorMsg = responseDef
                    ? `${responseDef.name}: ${responseDef.description}`
                    : `Unknown response code: 0x${response.code.toString(16)}`
                throw new Error(errorMsg)
            }
        } catch (error) {
            this.logger.updateEntry(logId, {
                status: 'failed',
                message: 'Failed to set',
            })
            throw error
        }
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
        const paramBytes = params.reduce((sum, p) => sum + p.length, 0)
        const length = 12 + paramBytes
        const buffer = new Uint8Array(length)
        const view = new DataView(buffer.buffer)

        view.setUint32(0, length, true)
        view.setUint16(4, 1, true) // COMMAND type
        view.setUint16(6, code, true)
        view.setUint32(8, transactionId, true)

        let offset = 12
        for (const param of params) {
            buffer.set(param, offset)
            offset += param.length
        }

        return buffer
    }

    private buildData(code: number, transactionId: number, data: Uint8Array): Uint8Array {
        const length = 12 + data.length
        const buffer = new Uint8Array(length)
        const view = new DataView(buffer.buffer)

        view.setUint32(0, length, true)
        view.setUint16(4, 2, true) // DATA type
        view.setUint16(6, code, true)
        view.setUint32(8, transactionId, true)

        buffer.set(data, 12)

        return buffer
    }

    private parseContainer(data: Uint8Array): { type: number; code: number; transactionId: number; payload: Uint8Array } {
        if (data.length < 12) {
            throw new Error(`Container too short: ${data.length} bytes`)
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const length = view.getUint32(0, true)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)
        const payload = data.slice(12)

        return { type, code, transactionId, payload }
    }

    protected resolveCodec<T>(codec: CodecDefinition<T>): { encode: (value: T) => Uint8Array; decode: (buffer: Uint8Array, offset?: number) => { value: T; bytesRead: number } } {
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
