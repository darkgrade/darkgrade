import type { PTPRegistry } from '@ptp/types/codec'
import { sonyDatasetHeader, sonyDatasetSection } from '@vendors/sony/datasets/sony-live-view-dataset'

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

const META_INFO_BYTES = 9 * 4

export function parseOsdImageDataset(data: Uint8Array, registry: PTPRegistry): OsdImageDataset {
    const [offsetToImage, imageSize, offsetToMetaInfo, metaInfoSize] = sonyDatasetHeader(data, registry)
    const meta = metaInfoSize >= META_INFO_BYTES ? sonyDatasetSection(data, offsetToMetaInfo, META_INFO_BYTES) : undefined
    const fields = meta && Array.from({ length: 9 }, (_, index) => registry.codecs.uint32.decode(meta, index * 4).value)
    return {
        offsetToImage,
        imageSize,
        offsetToMetaInfo,
        metaInfoSize,
        image: sonyDatasetSection(data, offsetToImage, imageSize) ?? new Uint8Array(),
        metaInfo: fields
            ? {
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
            : null,
    }
}
