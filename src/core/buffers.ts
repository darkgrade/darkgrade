/**
 * Buffer Operations
 * Provides low-level buffer manipulation for PTP protocol data
 */

import { DataType, DataTypeValue } from '@constants/types'

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
 * Used primarily in transport layer and API layer for Frame/Photo classes
 * @param data - Uint8Array to convert
 * @returns Buffer
 */
export function toBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data)
}

/**
 * Convert Buffer or any array-like to Uint8Array
 * Used primarily in transport layer for cross-platform compatibility
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
export function encodePTPValue(value: any, dataType: DataTypeValue): Uint8Array {
  const buffer = new ArrayBuffer(8)
  const uint8Buffer = new Uint8Array(buffer)
  const view = createDataView(uint8Buffer)

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
export function decodePTPValue(data: Uint8Array, dataType: DataTypeValue): any {
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
      return decoder.decode(copySlice(data, 2, 2 + length))
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
 * Create a Uint8Array view from a slice of another Uint8Array with proper offset handling (no copy)
 * @param data - Source Uint8Array
 * @param offset - Starting offset in the source array
 * @param length - Number of bytes to slice
 * @returns New Uint8Array view of the sliced data (no copy)
 */
export function viewSlice(data: Uint8Array, offset: number, length: number): Uint8Array {
  return new Uint8Array(data.buffer, data.byteOffset + offset, length)
}

/**
 * Copy a slice of Uint8Array to a new Uint8Array
 * @param data - Source Uint8Array
 * @param start - Starting offset in the source array
 * @param end - Ending offset in the source array (optional)
 * @returns New Uint8Array with copied data
 */
export function copySlice(data: Uint8Array, start: number, end?: number): Uint8Array {
  return new Uint8Array(data.slice(start, end))
}

/**
 * Validate buffer has minimum required length
 * @param data - Buffer to validate
 * @param minLength - Minimum required length
 * @param context - Context string for error message
 * @throws Error if buffer is too short
 */
export function validateBufferLength(data: Uint8Array, minLength: number, context: string): void {
  if (data.byteLength < minLength) {
    throw new Error(`${context}: buffer too short (${data.byteLength} < ${minLength})`)
  }
}

/**
 * Parse a PTP array of UINT32 values
 * PTP arrays are formatted as: [count:uint32][value1:uint32][value2:uint32]...
 * @param data - Buffer containing the array
 * @param offset - Starting offset in the buffer (default: 0)
 * @returns Array of parsed values
 */
export function parsePTPUint32Array(data: Uint8Array, offset = 0): number[] {
  if (data.length < offset + 4) return []
  
  const view = createDataView(data)
  const count = view.getUint32(offset, true)
  const values: number[] = []
  
  // Ensure we don't read beyond buffer bounds
  const maxItems = Math.min(count, Math.floor((data.length - offset - 4) / 4))
  
  for (let i = 0; i < maxItems; i++) {
    values.push(view.getUint32(offset + 4 + i * 4, true))
  }
  
  return values
}

