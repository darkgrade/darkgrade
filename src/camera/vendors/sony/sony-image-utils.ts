/**
 * Sony Image Utilities
 * Sony-specific image extraction and parsing utilities
 */

import { findByteSequence } from '@core/buffers'
import { extractJPEG } from '@core/images'

// Sony-specific constants
export const SONY_LIVEVIEW = {
  HEADER_SIZE: 136,
  DEFAULT_WIDTH: 640,
  DEFAULT_HEIGHT: 480,
  START_MARKER: [0xff, 0x01, 0x00, 0x00],
} as const

/**
 * Extract JPEG from Sony live view data
 * @param data - Sony live view data with header
 * @returns JPEG data or null if invalid
 */
export function extractSonyLiveViewJPEG(data: Uint8Array): Uint8Array | null {
  // Sony live view data has a fixed header
  if (data.length < SONY_LIVEVIEW.HEADER_SIZE) {
    return null
  }

  const jpegData = data.slice(SONY_LIVEVIEW.HEADER_SIZE)

  // Verify JPEG start marker
  if (jpegData.length < 2 || jpegData[0] !== 0xFF || jpegData[1] !== 0xD8) {
    return null
  }

  return jpegData
}

/**
 * Extract JPEG from Sony SDIO stream with start marker
 * @param data - SDIO stream data
 * @returns JPEG data or null if not found
 */
export function extractSDIOStreamJPEG(data: Uint8Array): Uint8Array | null {
  // Find the start marker
  const startMarker = findByteSequence(data, SONY_LIVEVIEW.START_MARKER)
  if (startMarker === -1) return null

  // Extract JPEG after the marker
  return extractJPEG(data, startMarker)
}