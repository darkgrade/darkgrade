import type { PTPRegistry } from '@ptp/types/codec'
import { jpegThroughEnd } from '@vendors/generic/jpeg-end'

/** The header of a Sony image dataset: two (offset, size) pairs of uint32, offsets from the dataset start. */
export function sonyDatasetHeader(buffer: Uint8Array, registry: PTPRegistry): [number, number, number, number] {
    const [first = 0, firstSize = 0, second = 0, secondSize = 0] = [0, 4, 8, 12].map(
        field => registry.codecs.uint32.decode(buffer, field).value
    )
    return [first, firstSize, second, secondSize]
}

/** The bytes at `start` for `size`, when both are set and the buffer holds them all. */
export function sonyDatasetSection(buffer: Uint8Array, start: number, size: number): Uint8Array | undefined {
    return start > 0 && size > 0 && buffer.length >= start + size ? buffer.slice(start, start + size) : undefined
}

export interface LiveViewDataset {
    /** The whole JPEG; empty when the dataset holds none, or one without its end marker. */
    liveViewImage: Uint8Array
    /** The dataset held image bytes, but no JPEG end marker: the picture is incomplete. */
    incomplete?: true
    /** Sony FocalFrameInfo bytes (`@vendors/sony/focal-frame-info`), when the frame carries them. */
    focalFrameInfo?: Uint8Array
}

export function parseLiveViewDataset(data: Uint8Array, registry: PTPRegistry): LiveViewDataset {
    const [imageOffset, imageSize, frameInfoOffset, frameInfoSize] = sonyDatasetHeader(data, registry)
    const focalFrameInfo = sonyDatasetSection(data, frameInfoOffset, frameInfoSize)
    const section = sonyDatasetSection(data, imageOffset, imageSize)
    const image = section && jpegThroughEnd(section)
    return {
        liveViewImage: image ?? new Uint8Array(),
        ...(section && !image && { incomplete: true as const }),
        ...(focalFrameInfo && { focalFrameInfo }),
    }
}
