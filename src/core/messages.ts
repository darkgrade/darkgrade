/**
 * PTP Message Builder
 * Constructs and parses PTP protocol messages
 */

import { Response, Event } from '@constants/types'
import { ContainerTypes, containerTypeToMessageType, PTP_CONTAINER, PTP_LIMITS, EVENT_LIMITS } from '@constants/ptp/containers'
import { createDataView, parsePTPParameters } from '@core/buffers'

/**
 * Message builder interface for constructing and parsing PTP messages
 */
export interface MessageBuilderInterface {
    /**
     * Build a command message
     * @param operation - Operation code
     * @param parameters - Operation parameters
     * @returns Encoded message
     */
    buildCommand(operation: number, parameters?: number[]): Uint8Array

    /**
     * Build a data message
     * @param operation - Operation code
     * @param data - Data payload
     * @returns Encoded message
     */
    buildData(operation: number, data: Uint8Array): Uint8Array

    /**
     * Parse a response message
     * @param data - Raw response data
     * @returns Parsed response
     */
    parseResponse(data: Uint8Array): Response

    /**
     * Parse an event message
     * @param data - Raw event data
     * @returns Parsed event
     */
    parseEvent(data: Uint8Array): Event

    /**
     * Parse data payload
     * @param data - Raw data
     * @returns Parsed data
     */
    parseData(data: Uint8Array): ParsedData

    /**
     * Get next transaction ID
     */
    getNextTransactionId(): number

    /**
     * Reset transaction ID (for new sessions)
     */
    resetTransactionId(): void
}

/**
 * Parsed PTP data
 */
export interface ParsedData {
    sessionId: number
    transactionId: number
    payload: Uint8Array
}

/**
 * PTP Message Builder implementation
 */
export class PTPMessageBuilder implements MessageBuilderInterface {
    private transactionId = 0

    /**
     * Get next transaction ID
     */
    getNextTransactionId(): number {
        this.transactionId++
        if (this.transactionId > PTP_LIMITS.MAX_TRANSACTION_ID) {
            this.transactionId = 1
        }
        return this.transactionId
    }

    /**
     * Build a command message
     */
    buildCommand(operation: number, parameters: number[] = []): Uint8Array {
        const paramCount = parameters.length
        const length = PTP_CONTAINER.HEADER_SIZE + paramCount * PTP_CONTAINER.PARAM_SIZE
        const buffer = new ArrayBuffer(length)
        const view = new DataView(buffer)

        // Container header
        view.setUint32(0, length, true) // Length
        view.setUint16(4, ContainerTypes.COMMAND_BLOCK, true) // Type
        view.setUint16(6, operation, true) // Code
        view.setUint32(8, this.getNextTransactionId(), true) // Transaction ID

        // Parameters (up to MAX_PARAMS)
        for (let index = 0; index < Math.min(paramCount, PTP_CONTAINER.MAX_PARAMS); index++) {
            const param = parameters[index]
            if (param !== undefined) {
                view.setUint32(PTP_CONTAINER.HEADER_SIZE + index * PTP_CONTAINER.PARAM_SIZE, param, true)
            }
        }

        return new Uint8Array(buffer)
    }

    /**
     * Build a data message
     */
    buildData(operation: number, data: Uint8Array): Uint8Array {
        const length = PTP_CONTAINER.HEADER_SIZE + data.byteLength
        const buffer = new ArrayBuffer(length)
        const view = new DataView(buffer)

        // Container header
        view.setUint32(0, length, true) // Length
        view.setUint16(4, ContainerTypes.DATA_BLOCK, true) // Type
        view.setUint16(6, operation, true) // Code
        view.setUint32(8, this.transactionId, true) // Use current transaction ID

        // Copy data payload
        const uint8View = new Uint8Array(buffer)
        uint8View.set(data, PTP_CONTAINER.HEADER_SIZE)

        return uint8View
    }

    /**
     * Parse a response message
     */
    parseResponse(data: Uint8Array): Response {
        if (data.byteLength < PTP_CONTAINER.HEADER_SIZE) {
            throw new Error('Invalid response: too short')
        }

        const view = createDataView(data)

        const length = view.getUint32(0, true)
        const type = view.getUint16(4, true)
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        // Parse parameters if present
        const paramBytes = length - PTP_CONTAINER.HEADER_SIZE
        const parameters = (paramBytes > 0 && paramBytes <= PTP_CONTAINER.MAX_PARAM_BYTES)
            ? parsePTPParameters(view, PTP_CONTAINER.HEADER_SIZE, paramBytes / PTP_CONTAINER.PARAM_SIZE)
            : []

        // Map container type to message type
        const messageType = containerTypeToMessageType(type)

        return {
            code,
            sessionId: 0, // Session ID not in response container
            transactionId,
            parameters,
            type: messageType,
        }
    }

    /**
     * Parse an event message
     */
    parseEvent(data: Uint8Array): Event {
        if (data.byteLength < PTP_CONTAINER.HEADER_SIZE) {
            throw new Error('Invalid event: too short')
        }

        const view = createDataView(data)

        const length = view.getUint32(0, true)
        view.getUint16(4, true) // Should be EVENT_BLOCK
        const code = view.getUint16(6, true)
        const transactionId = view.getUint32(8, true)

        // Parse parameters if present
        const paramBytes = length - PTP_CONTAINER.HEADER_SIZE
        const parameters = (paramBytes > 0 && paramBytes <= EVENT_LIMITS.MAX_PARAM_BYTES)
            ? parsePTPParameters(view, PTP_CONTAINER.HEADER_SIZE, paramBytes / PTP_CONTAINER.PARAM_SIZE)
            : []

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
        if (data.byteLength < PTP_CONTAINER.HEADER_SIZE) {
            throw new Error('Invalid data: too short')
        }

        const view = createDataView(data)

        view.getUint32(0, true) // Length
        view.getUint16(4, true) // Should be DATA_BLOCK
        view.getUint16(6, true) // Code
        const transactionId = view.getUint32(8, true)

        // Extract payload (everything after header)
        const payload = new Uint8Array(data.buffer, data.byteOffset + PTP_CONTAINER.HEADER_SIZE, data.byteLength - PTP_CONTAINER.HEADER_SIZE)

        return {
            sessionId: 0, // Session ID not in data container
            transactionId,
            payload,
        }
    }

    /**
     * Reset transaction ID (useful for new sessions)
     */
    resetTransactionId(): void {
        this.transactionId = 0
    }
}
