import { LiveViewFrame, FrameFormat } from '@camera/interfaces/liveview.interface'

/**
 * Sony SDIO Parser - Extracts live view frames from Sony's proprietary SDIO format
 * Externalized from SonyCamera for potential future use
 */
export class SonySDIOParser {
  private frameBuffer = new Uint8Array(1024 * 1024) // 1MB buffer
  private frameSize = 0

  /**
   * Parse SDIO data to extract live view frame
   */
  parseSDIOData(data: Uint8Array): LiveViewFrame | null {
    if (data.length < 136) {
      return null
    }

    // Check for start marker
    const startMarker = this.findSequence(data, [0xff, 0x01, 0x00, 0x00])
    if (startMarker === -1) {
      return null
    }

    // Find JPEG start
    const jpegStart = this.findSequence(data, [0xff, 0xd8], startMarker)
    if (jpegStart === -1) {
      return null
    }

    // Find JPEG end
    const jpegEnd = this.findSequence(data, [0xff, 0xd9], jpegStart)
    if (jpegEnd === -1) {
      return null
    }

    const jpegData = data.slice(jpegStart, jpegEnd + 2)

    return {
      data: jpegData,
      timestamp: Date.now(),
      width: 640,  // Default, should be parsed from JPEG
      height: 480, // Default, should be parsed from JPEG
      format: FrameFormat.JPEG
    }
  }

  /**
   * Process chunked SDIO data
   */
  processChunk(chunk: Uint8Array): LiveViewFrame | null {
    const SDIO_HEADER_SIZE = 8

    if (chunk.length < SDIO_HEADER_SIZE) {
      return null
    }

    // Parse SDIO header
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    const packetType = view.getUint16(0, true)
    const packetSize = view.getUint32(4, true)

    if (packetType === 0x01) { // Start of frame
      this.frameSize = 0
      this.frameBuffer.fill(0)
    }

    // Copy data to frame buffer
    const dataStart = SDIO_HEADER_SIZE
    const dataEnd = Math.min(chunk.length, dataStart + packetSize)
    const data = chunk.slice(dataStart, dataEnd)
    
    if (this.frameSize + data.length <= this.frameBuffer.length) {
      this.frameBuffer.set(data, this.frameSize)
      this.frameSize += data.length
    }

    // Check if we have a complete frame
    if (packetType === 0x02) { // End of frame
      const completeFrame = this.frameBuffer.slice(0, this.frameSize)
      return this.parseSDIOData(completeFrame)
    }

    return null
  }

  /**
   * Find byte sequence in buffer
   */
  private findSequence(buffer: Uint8Array, sequence: number[], start = 0): number {
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
}