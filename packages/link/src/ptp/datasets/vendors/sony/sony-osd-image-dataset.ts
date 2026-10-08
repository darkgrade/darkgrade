import { CustomCodec, type PTPRegistry } from '@ptp/types/codec'

/**
 * Placement of the OSD over the live-view frame: nine uint32 LE values. Fields two to
 * nine match the Camera Remote SDK's CrOSDImageMetaInfo on an ILCE-6700 (osd 720x480,
 * live view at 360,240 sized 720x480, rotation 0). The leading value was a constant
 * 0x65 across frames and menus; its meaning is unknown, so it is passed through raw.
 */
export interface OsdImageMetaInfo {
    leadingValue: number
    liveViewPositionExists: boolean
    osdWidth: number
    osdHeight: number
    liveViewPositionX: number
    liveViewPositionY: number
    liveViewWidth: number
    liveViewHeight: number
    degree: number
}

export interface OsdImageDataset {
    offsetToImage: number
    imageSize: number
    offsetToMetaInfo: number
    metaInfoSize: number
    /** RGBA PNG of the camera's on-screen display; transparent where live view shows through. */
    image: Uint8Array
    metaInfo: OsdImageMetaInfo | null
}

const META_INFO_FIELDS = 9

export class OsdImageDatasetCodec extends CustomCodec<OsdImageDataset> {
    encode(value: OsdImageDataset): Uint8Array {
        throw new Error('Encoding OsdImageDataset is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: OsdImageDataset; bytesRead: number } {
        const u32 = this.registry.codecs.uint32
        const [offsetToImage, imageSize, offsetToMetaInfo, metaInfoSize] = [0, 4, 8, 12].map(
            field => u32.decode(buffer, offset + field).value
        )

        let image: Uint8Array = new Uint8Array()
        if (offsetToImage > 0 && imageSize > 0 && buffer.length >= offset + offsetToImage + imageSize) {
            image = buffer.slice(offset + offsetToImage, offset + offsetToImage + imageSize)
        }

        let metaInfo: OsdImageMetaInfo | null = null
        if (
            offsetToMetaInfo > 0 &&
            metaInfoSize >= META_INFO_FIELDS * 4 &&
            buffer.length >= offset + offsetToMetaInfo + META_INFO_FIELDS * 4
        ) {
            const fields = Array.from({ length: META_INFO_FIELDS }, (_, index) =>
                u32.decode(buffer, offset + offsetToMetaInfo + index * 4).value
            )
            metaInfo = {
                leadingValue: fields[0]!,
                liveViewPositionExists: fields[1] === 1,
                osdWidth: fields[2]!,
                osdHeight: fields[3]!,
                liveViewPositionX: fields[4]!,
                liveViewPositionY: fields[5]!,
                liveViewWidth: fields[6]!,
                liveViewHeight: fields[7]!,
                degree: fields[8]!,
            }
        }

        return {
            value: { offsetToImage, imageSize, offsetToMetaInfo, metaInfoSize, image, metaInfo },
            bytesRead: buffer.length - offset,
        }
    }
}

export function parseOsdImageDataset(data: Uint8Array, registry: PTPRegistry): OsdImageDataset {
    return new OsdImageDatasetCodec(registry).decode(data).value
}
