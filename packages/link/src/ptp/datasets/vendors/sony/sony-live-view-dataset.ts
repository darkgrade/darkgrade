import { CustomCodec, type PTPRegistry } from '@ptp/types/codec'

export interface FocalFrameInfo {
    data: Uint8Array
}

export interface LiveViewDataset {
    offsetToLiveViewImage: number
    liveViewImageSize: number
    offsetToFocalFrameInfo: number
    focalFrameInfoSize: number
    reserved: Uint8Array
    liveViewImage: Uint8Array
    focalFrameInfo: FocalFrameInfo | null
}

export class LiveViewDatasetCodec extends CustomCodec<LiveViewDataset> {
    encode(value: LiveViewDataset): Uint8Array {
        throw new Error('Encoding LiveViewDataset is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: LiveViewDataset; bytesRead: number } {
        const u32 = this.registry.codecs.uint32

        let currentOffset = offset

        const offsetToLiveViewImageResult = u32.decode(buffer, currentOffset)
        const offsetToLiveViewImage = offsetToLiveViewImageResult.value
        currentOffset += offsetToLiveViewImageResult.bytesRead

        const liveViewImageSizeResult = u32.decode(buffer, currentOffset)
        const liveViewImageSize = liveViewImageSizeResult.value
        currentOffset += liveViewImageSizeResult.bytesRead

        const offsetToFocalFrameInfoResult = u32.decode(buffer, currentOffset)
        const offsetToFocalFrameInfo = offsetToFocalFrameInfoResult.value
        currentOffset += offsetToFocalFrameInfoResult.bytesRead

        const focalFrameInfoSizeResult = u32.decode(buffer, currentOffset)
        const focalFrameInfoSize = focalFrameInfoSizeResult.value
        currentOffset += focalFrameInfoSizeResult.bytesRead

        const minOffset = Math.min(
            offsetToLiveViewImage > 0 ? offsetToLiveViewImage : Infinity,
            offsetToFocalFrameInfo > 0 ? offsetToFocalFrameInfo : Infinity
        )
        const reservedSize = minOffset > 16 && minOffset !== Infinity ? minOffset - 16 : 0
        const reserved = reservedSize > 0 ? buffer.slice(offset + 16, offset + 16 + reservedSize) : new Uint8Array()

        let liveViewImage: Uint8Array = new Uint8Array()
        if (
            offsetToLiveViewImage > 0 &&
            liveViewImageSize > 0 &&
            buffer.length >= offset + offsetToLiveViewImage + liveViewImageSize
        ) {
            liveViewImage = buffer.slice(
                offset + offsetToLiveViewImage,
                offset + offsetToLiveViewImage + liveViewImageSize
            )
        }

        let focalFrameInfo: FocalFrameInfo | null = null
        if (
            offsetToFocalFrameInfo > 0 &&
            focalFrameInfoSize > 0 &&
            buffer.length >= offset + offsetToFocalFrameInfo + focalFrameInfoSize
        ) {
            const focalFrameData = buffer.slice(
                offset + offsetToFocalFrameInfo,
                offset + offsetToFocalFrameInfo + focalFrameInfoSize
            )
            focalFrameInfo = {
                data: focalFrameData,
            }
        }

        const bytesRead = buffer.length - offset

        return {
            value: {
                offsetToLiveViewImage,
                liveViewImageSize,
                offsetToFocalFrameInfo,
                focalFrameInfoSize,
                reserved,
                liveViewImage,
                focalFrameInfo,
            },
            bytesRead,
        }
    }
}

export function parseLiveViewDataset(data: Uint8Array, registry: PTPRegistry): LiveViewDataset {
    const codec = new LiveViewDatasetCodec(registry)
    return codec.decode(data).value
}
