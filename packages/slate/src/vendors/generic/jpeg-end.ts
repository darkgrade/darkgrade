import { CameraOutcomeUnknownError } from '@camera/errors'

const MARKER = 0xff
const START_OF_IMAGE = 0xd8
const END_OF_IMAGE = 0xd9
const START_OF_SCAN = 0xda
const STUFFED_ZERO = 0x00

/** Markers that stand alone, without a length: TEM and the restart markers RST0–RST7. */
function standalone(marker: number): boolean {
    return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)
}

/** The offset of the marker that ends the entropy-coded data starting at `offset`, skipping stuffed zeros and restarts. */
function scanEnd(bytes: Uint8Array, offset: number): number | undefined {
    for (let position = offset; position + 1 < bytes.length; position++) {
        if (bytes[position] !== MARKER) continue
        const next = bytes[position + 1]!
        if (next !== STUFFED_ZERO && next !== MARKER && !standalone(next)) return position
    }
    return undefined
}

/** The offset just past the end marker the JPEG's own structure leads to, or undefined when it never reaches one. */
function structuralEnd(bytes: Uint8Array): number | undefined {
    if (bytes[0] !== MARKER || bytes[1] !== START_OF_IMAGE) return undefined
    let offset = 2
    while (offset + 1 < bytes.length) {
        if (bytes[offset] !== MARKER) return undefined
        const marker = bytes[offset + 1]!
        if (marker === MARKER) {
            offset++ // fill before a marker
            continue
        }
        if (marker === END_OF_IMAGE) return offset + 2
        if (standalone(marker)) {
            offset += 2
            continue
        }
        if (offset + 3 >= bytes.length) return undefined
        const segmentEnd = offset + 2 + ((bytes[offset + 2]! << 8) | bytes[offset + 3]!)
        if (segmentEnd > bytes.length) return undefined
        const next = marker === START_OF_SCAN ? scanEnd(bytes, segmentEnd) : segmentEnd
        if (next === undefined) return undefined
        offset = next
    }
    return undefined
}

/**
 * The JPEG in `bytes` through its end marker (FF D9), without whatever the camera sent after it, or
 * undefined when it ends without the marker. The marker is found by walking the JPEG's segments and
 * scan, so an end marker inside embedded data (an EXIF thumbnail) is not taken for it. Cameras pad
 * a picture: the FX2 (fw 1.01) rounds a live-view image's size up to a multiple of 512 with 0xFF
 * (size 22,016, FF D9 at 21,992); the R6 Mark III (fw 3-1.0.1) sends a 10,752-byte GetThumb whose
 * FF D9 is at 10,265, then 473 zero bytes and a 12-byte trailer (darkgrade02, 2026-11-25).
 */
export function jpegThroughEnd(bytes: Uint8Array): Uint8Array | undefined {
    const end = structuralEnd(bytes)
    if (end !== undefined) return bytes.subarray(0, end)
    // A picture whose segments do not walk cleanly is still whole when it ends with the marker and fill.
    let trimmed = bytes.length
    while (trimmed > 2 && (bytes[trimmed - 1] === MARKER || bytes[trimmed - 1] === STUFFED_ZERO)) trimmed--
    return bytes[trimmed - 2] === MARKER && bytes[trimmed - 1] === END_OF_IMAGE ? bytes.subarray(0, trimmed) : undefined
}

/** A card file's preview as the whole JPEG it promises; one without its end marker is never returned. */
export function completePreview(bytes: Uint8Array): Uint8Array {
    const jpeg = jpegThroughEnd(bytes)
    if (jpeg) return jpeg
    throw new CameraOutcomeUnknownError(
        'getMediaPreview',
        `The camera sent a ${bytes.length}-byte preview without a JPEG end marker; no picture was returned`
    )
}
