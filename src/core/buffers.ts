/**
 * Buffer Operations
 * Provides low-level buffer manipulation for PTP protocol data
 */

import { DataType } from '@constants/types'

/**
 * Create a DataView from a Uint8Array with proper offset handling
 * @param data - Uint8Array to create DataView from
 * @returns DataView with correct buffer, offset, and length
 */
export function createDataView(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength)
}

/**
 * Convert Uint8Array to Buffer for Node.js compatibility
 * @param data - Uint8Array to convert
 * @returns Buffer
 */
export function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data)
}

/**
 * Convert Buffer or any array-like to Uint8Array
 * @param data - Buffer or array-like to convert
 * @returns Uint8Array
 */
export function toUint8Array(data: Buffer | ArrayBuffer | ArrayLike<number>): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }
  return new Uint8Array(data)
}

/**
 * Encode a value into a buffer based on PTP data type
 */
export function encodePTPValue(value: any, dataType: number): Uint8Array {
  const buffer = new ArrayBuffer(8)
  const view = new DataView(buffer)

  switch (dataType) {
    case DataType.UINT8:
      view.setUint8(0, value)
      return new Uint8Array(buffer, 0, 1)
    case DataType.INT8:
      view.setInt8(0, value)
      return new Uint8Array(buffer, 0, 1)
    case DataType.UINT16:
      view.setUint16(0, value, true)
      return new Uint8Array(buffer, 0, 2)
    case DataType.INT16:
      view.setInt16(0, value, true)
      return new Uint8Array(buffer, 0, 2)
    case DataType.UINT32:
      view.setUint32(0, value, true)
      return new Uint8Array(buffer, 0, 4)
    case DataType.INT32:
      view.setInt32(0, value, true)
      return new Uint8Array(buffer, 0, 4)
    case DataType.STRING:
      const encoder = new TextEncoder()
      const utf8 = encoder.encode(value)
      const result = new Uint8Array(2 + utf8.length)
      result[0] = utf8.length
      result[1] = 0
      result.set(utf8, 2)
      return result
    default:
      return new Uint8Array()
  }
}

/**
 * Decode a value from a buffer based on PTP data type
 */
export function decodePTPValue(data: Uint8Array, dataType: number): any {
  if (!data || data.length === 0) return null

  const view = createDataView(data)

  switch (dataType) {
    case DataType.UINT8:
      return view.getUint8(0)
    case DataType.INT8:
      return view.getInt8(0)
    case DataType.UINT16:
      return view.getUint16(0, true)
    case DataType.INT16:
      return view.getInt16(0, true)
    case DataType.UINT32:
      return view.getUint32(0, true)
    case DataType.INT32:
      return view.getInt32(0, true)
    case DataType.STRING:
      const length = view.getUint16(0, true)
      const decoder = new TextDecoder()
      return decoder.decode(data.slice(2, 2 + length))
    default:
      return data
  }
}

/**
 * Find a byte sequence in a buffer
 * @param buffer - Buffer to search in
 * @param sequence - Byte sequence to find
 * @param start - Starting offset (default: 0)
 * @returns Index of first match or -1 if not found
 */
export function findByteSequence(buffer: Uint8Array, sequence: readonly number[], start = 0): number {
  for (let i = start; i <= buffer.length - sequence.length; i++) {
    let found = true
    for (let j = 0; j < sequence.length; j++) {
      if (buffer[i + j] !== sequence[j]) {
        found = false
        break
      }
    }
    if (found) return i
  }
  return -1
}

/**
 * Parse PTP parameters from a buffer
 * @param view - DataView to read from
 * @param offset - Starting offset
 * @param count - Number of parameters to read
 * @param paramSize - Size of each parameter in bytes (default: 4)
 * @returns Array of parameter values
 */
export function parsePTPParameters(view: DataView, offset: number, count: number, paramSize = 4): number[] {
  const parameters: number[] = []
  for (let i = 0; i < count; i++) {
    parameters.push(view.getUint32(offset + i * paramSize, true))
  }
  return parameters
}

/**
 * Extract a property value from Sony's all-properties response format
 * @param data - Response data containing multiple properties
 * @param propertyCode - Property code to search for
 * @returns Property data or empty array if not found
 */
export function extractPropertyFromResponse(data: Uint8Array, propertyCode: number): Uint8Array {
  const view = createDataView(data)
  let offset = 0

  while (offset < data.length - 4) {
    const code = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    
    if (code === propertyCode) {
      return data.slice(offset + 4, offset + 4 + size)
    }
    
    offset += 4 + size
  }

  return new Uint8Array()
}