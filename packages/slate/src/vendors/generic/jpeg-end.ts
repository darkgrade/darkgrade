import { CameraOutcomeUnknownError } from '@camera/errors'

/**
 * The JPEG in `bytes` through its end marker (FF D9), without the fill (0xFF or 0x00) a camera
 * pads it with, or undefined when it ends without the marker. The FX2 (fw 1.01) rounds a live-view
 * image's size up to a multiple of 512 and fills it with 0xFF: size 22,016, FF D9 at 21,992
 * (darkgrade02, 2026-11-25).
 */
export function jpegThroughEnd(bytes: Uint8Array): Uint8Array | undefined {
    let end = bytes.length
    while (end > 2 && (bytes[end - 1] === 0xff || bytes[end - 1] === 0x00)) end--
    return bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9 ? bytes.subarray(0, end) : undefined
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
