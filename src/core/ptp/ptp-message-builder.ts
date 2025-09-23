/**
 * PTP Message Builder
 * Constructs and parses PTP protocol messages
 */

import {
    MessageBuilderInterface,
    ParsedResponse,
    ParsedEvent,
    ParsedData,
    MessageType,
} from '@core/interfaces/message-builder.interface'
import { ContainerTypes, ContainerType } from '@constants/ptp'

export class PTPMessageBuilder implements MessageBuilderInterface {
    private transactionId = 0

    /**
     * Get next transaction ID
     */
    getNextTransactionId(): number {
        this.transactionId++
        if (this.transactionId > 0xffffffff) {
            this.transactionId = 1
        }
        return this.transactionId
    }

    /**
     * Build a command message
     */
    buildCommand(operation: number, parameters: number[] = []): Uint8Array {
        const paramCount = parameters.length
        const length = 12 + paramCount * 4
        const buffer = new ArrayBuffer(length)
        const view = new DataView(buffer)

        // Container header
        view.setUint32(0, length, true) // Length
        view.setUint16(4, ContainerTypes.COMMAND_BLOCK, true) // Type
        view.setUint16(6, operation, true) // Code
        view.setUint32(8, this.getNextTransactionId(), true) // Transaction ID

        // Parameters (up to 5)
        for (let index = 0; index < Math.min(paramCount, 5); index++) {
            const param = parameters[index]
            if (param !== undefined) {
                view.setUint32(12 + index * 4, param, true)
            }
        }

        return new Uint8Array(buffer)
    }

    /**
     * Build a data message
     */
    buildData(operation: number, data: Uint8Array): Uint8Array {
        const length = 12 + data.byteLength
        const buffer = new ArrayBuffer(length)
        const view = new DataView(buffer)

        // Container header
        view.setUint32(0, length, true) // Length
        view.setUint16(4, ContainerTypes.DATA_BLOCK, true) // Type
        view.setUint16(6, operation, true) // Code
        view.setUint32(8, this.transactionId, true) // Use current transaction ID

        // Copy data payload
        const uint8View = new Uint8Array(buffer)
        uint8View.set(data, 12)

        return uint8View
    }

    /**
     * Parse a response message
     */
    parseResponse(data: Uint8Array): ParsedResponse {
        if (data.byteLength < 12) {
            throw new Error('Invalid response: too short')
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const length = view.getUint32(0, true)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        // Parse parameters if present
        const parameters: number[] = []
        const paramBytes = length - 12
        if (paramBytes > 0 && paramBytes <= 20) {
            // Max 5 parameters
            const paramCount = paramBytes / 4
            for (let index = 0; index < paramCount; index++) {
                parameters.push(view.getUint32(12 + index * 4, true))
            }
        }

        return {
            code,
            sessionId: 0, // Session ID not in response container
            transactionId,
            parameters,
            type: this.mapContainerTypeToMessageType(type as ContainerType),
        }
    }

    /**
     * Parse an event message
     */
    parseEvent(data: Uint8Array): ParsedEvent {
        if (data.byteLength < 12) {
            throw new Error('Invalid event: too short')
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        const length = view.getUint32(0, true)
        view.getUint16(4, true) // Should be EVENT_BLOCK
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        // Parse parameters if present
        const parameters: number[] = []
        const paramBytes = length - 12
        if (paramBytes > 0 && paramBytes <= 12) {
            // Events typically have up to 3 parameters
            const paramCount = paramBytes / 4
            for (let index = 0; index < paramCount; index++) {
                parameters.push(view.getUint32(12 + index * 4, true))
            }
        }

        return {
            code,
            sessionId: 0, // Session ID not in event container
            transactionId,
            parameters,
        }
    }

    /**
     * Parse data payload
     */
    parseData(data: Uint8Array): ParsedData {
        if (data.byteLength < 12) {
            throw new Error('Invalid data: too short')
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

        view.getUint32(0, true) // Length
        view.getUint16(4, true) // Should be DATA_BLOCK
        view.getUint16(6, true) // Code
        const transactionId = view.getUint32(8, true)

        // Extract payload (everything after header)
        const payload = new Uint8Array(data.buffer, data.byteOffset + 12, data.byteLength - 12)

        return {
            sessionId: 0, // Session ID not in data container
            transactionId,
            payload,
        }
    }

    /**
     * Helper to map container type to message type
     */
    private mapContainerTypeToMessageType(containerType: ContainerType): MessageType {
        switch (containerType) {
            case ContainerTypes.COMMAND_BLOCK:
                return MessageType.COMMAND
            case ContainerTypes.DATA_BLOCK:
                return MessageType.DATA
            case ContainerTypes.RESPONSE_BLOCK:
                return MessageType.RESPONSE
            case ContainerTypes.EVENT_BLOCK:
                return MessageType.EVENT
            default:
                throw new Error(`Unknown container type: 0x${(containerType as number).toString(16)}`)
        }
    }

    /**
     * Parse any PTP message and determine its type
     */
    parseMessage(data: Uint8Array): { type: MessageType; message: unknown } {
        if (data.byteLength < 12) {
            throw new Error('Invalid message: too short')
        }

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        const type = view.getUint16(4, true)

        switch (type) {
            case ContainerTypes.COMMAND_BLOCK:
                // Commands are typically not received, but handle for completeness
                return {
                    type: MessageType.COMMAND,
                    message: this.parseResponse(data), // Use same structure
                }
            case ContainerTypes.DATA_BLOCK:
                return {
                    type: MessageType.DATA,
                    message: this.parseData(data),
                }
            case ContainerTypes.RESPONSE_BLOCK:
                return {
                    type: MessageType.RESPONSE,
                    message: this.parseResponse(data),
                }
            case ContainerTypes.EVENT_BLOCK:
                return {
                    type: MessageType.EVENT,
                    message: this.parseEvent(data),
                }
            default:
                throw new Error(`Unknown message type: 0x${type.toString(16)}`)
        }
    }

    /**
     * Reset transaction ID (useful for new sessions)
     */
    resetTransactionId(): void {
        this.transactionId = 0
    }

    /**
     * Get current transaction ID without incrementing
     */
    getCurrentTransactionId(): number {
        return this.transactionId
    }
}
