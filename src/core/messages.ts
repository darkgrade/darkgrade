/**
 * PTP Message Builder
 * Constructs and parses PTP protocol messages
 */

import { ContainerTypes, containerTypeToMessageType, PTP_CONTAINER, PTP_LIMITS, EVENT_LIMITS } from '@constants/ptp/containers'
import { createDataView, sliceBuffer } from '@core/buffers'
import { Response, Event, HexCode } from '@constants/types'

/**
 * Validate buffer has minimum required length (private utility)
 */
function validateBufferLength(data: Uint8Array, minLength: number, context: string): void {
  if (data.byteLength < minLength) {
    throw new Error(`${context}: buffer too short (${data.byteLength} < ${minLength})`)
  }
}

/**
 * Message builder interface for constructing PTP messages
 */
export interface MessageBuilderInterface {
    /**
     * Build a command message
     * @param operation - Operation code
     * @param parameters - Operation parameters
     * @returns Encoded message
     */
    buildCommand(operation: HexCode, parameters?: HexCode[]): Uint8Array

    /**
     * Build a data message
     * @param operation - Operation code
     * @param data - Data payload
     * @returns Encoded message
     */
    buildData(operation: HexCode, data: Uint8Array): Uint8Array

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
 * Message parser interface for parsing PTP messages
 */
export interface MessageParserInterface {
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
 * Parse PTP parameters from a buffer
 * @param view - DataView to read from
 * @param offset - Starting offset
 * @param count - Number of parameters to read
 * @param paramSize - Size of each parameter in bytes (default: 4)
 * @returns Array of parameter values
 */
function parsePTPParameters(view: DataView, offset: number, count: number, paramSize = 4): HexCode[] {
  const parameters: HexCode[] = []
  for (let i = 0; i < count; i++) {
    parameters.push(view.getUint32(offset + i * paramSize, true))
  }
  return parameters
}

/**
 * Generic message parser for PTP containers
 * @param data - Raw message data
 * @param messageType - Type of message being parsed
 * @param maxParamBytes - Maximum parameter bytes allowed
 * @returns Parsed message object
 */
function parseGenericMessage(data: Uint8Array, messageType: string, maxParamBytes: number): {
  code: HexCode,
  transactionId: number,
  parameters: HexCode[],
  payload?: Uint8Array
} {
  validateBufferLength(data, PTP_CONTAINER.HEADER_SIZE, `Invalid ${messageType}`)
  
  const view = createDataView(data)
  const length = view.getUint32(0, true)
  view.getUint16(4, true) // Container type (not used in generic parser)
  const code = view.getUint16(6, true)
  const transactionId = view.getUint32(8, true)
  
  // Parse parameters if present
  const paramBytes = length - PTP_CONTAINER.HEADER_SIZE
  const parameters = (paramBytes > 0 && paramBytes <= maxParamBytes)
    ? parsePTPParameters(view, PTP_CONTAINER.HEADER_SIZE, paramBytes / PTP_CONTAINER.PARAM_SIZE)
    : []
  
  // For data messages, extract payload
  let payload: Uint8Array | undefined
  if (messageType === 'data') {
    const payloadLength = data.byteLength - PTP_CONTAINER.HEADER_SIZE
    payload = sliceBuffer(data, PTP_CONTAINER.HEADER_SIZE, payloadLength, { copy: false })
  }
  
  return {
    code,
    transactionId,
    parameters,
    ...(payload && { payload })
  }
}

/**
 * PTP Message Builder implementation
 */
export class PTPMessageBuilder implements MessageBuilderInterface, MessageParserInterface {
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
    buildCommand(operation: HexCode, parameters: HexCode[] = []): Uint8Array {
        const paramCount = parameters.length
        const length = PTP_CONTAINER.HEADER_SIZE + paramCount * PTP_CONTAINER.PARAM_SIZE
        const buffer = new ArrayBuffer(length)
        const uint8Buffer = new Uint8Array(buffer)
        const view = createDataView(uint8Buffer)

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
    buildData(operation: HexCode, data: Uint8Array): Uint8Array {
        const length = PTP_CONTAINER.HEADER_SIZE + data.byteLength
        const buffer = new ArrayBuffer(length)
        const uint8Buffer = new Uint8Array(buffer)
        const view = createDataView(uint8Buffer)

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
        const parsed = parseGenericMessage(data, 'response', PTP_CONTAINER.MAX_PARAM_BYTES)
        const view = createDataView(data)
        const type = view.getUint16(4, true)
        const messageType = containerTypeToMessageType(type)
        
        return {
            code: parsed.code,
            sessionId: 0, // Session ID not in response container
            transactionId: parsed.transactionId,
            parameters: parsed.parameters,
            type: messageType,
        }
    }

    /**
     * Parse an event message
     */
    parseEvent(data: Uint8Array): Event {
        const parsed = parseGenericMessage(data, 'event', EVENT_LIMITS.MAX_PARAM_BYTES)
        
        return {
            code: parsed.code,
            sessionId: 0, // Session ID not in event container
            transactionId: parsed.transactionId,
            parameters: parsed.parameters,
        }
    }

    /**
     * Parse data payload
     */
    parseData(data: Uint8Array): ParsedData {
        const parsed = parseGenericMessage(data, 'data', 0)
        
        return {
            sessionId: 0, // Session ID not in data container
            transactionId: parsed.transactionId,
            payload: parsed.payload!,
        }
    }

    /**
     * Reset transaction ID (useful for new sessions)
     */
    resetTransactionId(): void {
        this.transactionId = 0
    }
}
