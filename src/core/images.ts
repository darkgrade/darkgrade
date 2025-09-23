/**
 * JPEG Utilities
 * Generic JPEG parsing and extraction utilities
 */

import { findByteSequence } from '@core/buffers'

// JPEG markers
export const JPEG_MARKERS = {
  START: [0xff, 0xd8],
  END: [0xff, 0xd9],
  SOF0: [0xff, 0xc0], // Start of Frame
  SOS: [0xff, 0xda],  // Start of Scan
} as const

/**
 * Extract JPEG data from a buffer
 * @param data - Buffer potentially containing JPEG data
 * @param startOffset - Offset to start searching from
 * @returns JPEG data or null if not found
 */
export function extractJPEG(data: Uint8Array, startOffset = 0): Uint8Array | null {
  const jpegStart = findByteSequence(data, JPEG_MARKERS.START, startOffset)
  if (jpegStart === -1) return null

  const jpegEnd = findByteSequence(data, JPEG_MARKERS.END, jpegStart)
  if (jpegEnd === -1) return null

  // Include the end marker
  return data.slice(jpegStart, jpegEnd + 2)
}

/**
 * Parse JPEG dimensions from SOF0 marker
 * @param jpegData - JPEG data
 * @returns Width and height or default values if not found
 */
export function parseJPEGDimensions(jpegData: Uint8Array): { width: number; height: number } {
  const sof0 = findByteSequence(jpegData, JPEG_MARKERS.SOF0)
  
  if (sof0 === -1 || jpegData.length < sof0 + 9) {
    return {
      width: 640,  // Default width
      height: 480  // Default height
    }
  }

  const view = new DataView(jpegData.buffer, jpegData.byteOffset + sof0, 9)
  const height = view.getUint16(5, false) // Big-endian in JPEG
  const width = view.getUint16(7, false)  // Big-endian in JPEG

  return { width, height }
}