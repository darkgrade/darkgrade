import { CustomCodec } from '@ptp/types/codec'

export interface CanonLiveViewFrame {
    image: Uint8Array
    segments: Array<{ type: number; data: Uint8Array }>
}

export interface CanonLiveViewPosition {
    x: number
    y: number
    width: number
    height: number
    sensorWidth: number
    sensorHeight: number
    magnification: number
    minimumX: number
    minimumY: number
    maximumX: number
    maximumY: number
}

/** R6 III position/crop records; return unknown when a body's record layout differs. */
export function canonLiveViewPosition(frame: CanonLiveViewFrame): CanonLiveViewPosition | undefined {
    const words = (type: number, count: number): number[] | undefined => {
        const data = frame.segments.find(segment => segment.type === type)?.data
        if (data?.length !== count * 4) return undefined
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        return Array.from({ length: count }, (_, index) => view.getUint32(index * 4, true))
    }
    const zoom = words(4, 1)
    const position = words(5, 2)
    const crop = words(13, 4)
    const sensor = words(14, 2)
    const visible = words(19, 4)
    if (!zoom || !position || !crop || !sensor || !visible) return undefined
    const [x, y] = position
    const [, , width, height] = crop
    const [sensorWidth, sensorHeight] = sensor
    const [minimumX, minimumY, visibleWidth, visibleHeight] = visible
    const maximumX = minimumX + visibleWidth - width
    const maximumY = minimumY + visibleHeight - height
    if (
        crop[0] !== x ||
        crop[1] !== y ||
        ![1, 5, 6, 10, 15].includes(zoom[0]) ||
        width === 0 ||
        height === 0 ||
        sensorWidth === 0 ||
        sensorHeight === 0 ||
        x + width > sensorWidth ||
        y + height > sensorHeight ||
        visibleWidth < width ||
        visibleHeight < height ||
        minimumX + visibleWidth > sensorWidth ||
        minimumY + visibleHeight > sensorHeight ||
        x < minimumX ||
        y < minimumY ||
        x > maximumX ||
        y > maximumY
    )
        return undefined
    return {
        x,
        y,
        width,
        height,
        sensorWidth,
        sensorHeight,
        magnification: zoom[0],
        minimumX,
        minimumY,
        maximumX,
        maximumY,
    }
}

/** Length-prefixed EOS viewfinder segments, including the optional 0xffffffff header. */
export class CanonLiveViewDatasetCodec extends CustomCodec<CanonLiveViewFrame> {
    encode(): Uint8Array {
        throw new Error('Canon live-view frames are read only')
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonLiveViewFrame; bytesRead: number } {
        if (!Number.isInteger(offset) || offset < 0 || offset > buffer.length) {
            throw new Error('Invalid Canon live-view dataset offset')
        }
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const segments: CanonLiveViewFrame['segments'] = []
        let image: Uint8Array | undefined
        let position = offset
        while (position < buffer.length) {
            if (buffer.length - position < 8) throw new Error('Truncated Canon live-view segment header')
            const length = view.getUint32(position, true)
            const type = view.getUint32(position + 4, true)
            if (length < 8 || length > buffer.length - position) {
                throw new Error(`Invalid Canon live-view segment length ${length}`)
            }
            const data = buffer.subarray(position + 8, position + length)
            segments.push({ type, data })
            if ([1, 9, 11].includes(type) && data[0] === 0xff && data[1] === 0xd8) {
                if (data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) {
                    throw new Error('Truncated Canon live-view JPEG')
                }
                image ??= data
            }
            position += length
        }
        if (!image)
            throw new Error(
                'Canon viewfinder data contains no JPEG frame; the current output format may be unsupported'
            )
        return { value: { image, segments }, bytesRead: position - offset }
    }
}
