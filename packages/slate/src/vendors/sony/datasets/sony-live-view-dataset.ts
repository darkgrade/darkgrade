import type { PTPRegistry } from '@ptp/types/codec'

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
    liveViewImage: Uint8Array
    /** Sony FocalFrameInfo bytes (`@vendors/sony/focal-frame-info`), when the frame carries them. */
    focalFrameInfo?: Uint8Array
}

export function parseLiveViewDataset(data: Uint8Array, registry: PTPRegistry): LiveViewDataset {
    const [imageOffset, imageSize, frameInfoOffset, frameInfoSize] = sonyDatasetHeader(data, registry)
    const focalFrameInfo = sonyDatasetSection(data, frameInfoOffset, frameInfoSize)
    return {
        liveViewImage: sonyDatasetSection(data, imageOffset, imageSize) ?? new Uint8Array(),
        ...(focalFrameInfo && { focalFrameInfo }),
    }
}
