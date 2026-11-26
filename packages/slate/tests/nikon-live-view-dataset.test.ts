import { describe, expect, it } from 'vitest'
import { NikonLiveViewDatasetCodec } from '@vendors/nikon/datasets/nikon-live-view-dataset'
import { createNikonRegistry } from '@vendors/registry'

describe('NikonLiveViewDatasetCodec', () => {
    const legacyImage = () => {
        const jpeg = new Uint8Array(700).fill(0x5a)
        jpeg.set([0xff, 0xd8], 0)
        jpeg.set([0xff, 0xd9], jpeg.length - 2)
        return jpeg
    }
    it.each([
        ['a 700-byte', legacyImage()],
        ['a short', Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)],
    ])('uses the declared 512-byte display-info size of older bodies for %s image, reading no newer telemetry', (_size, jpeg) => {
        const displayInfoSize = 512
        const data = new Uint8Array(displayInfoSize + jpeg.length)
        const view = new DataView(data.buffer)
        view.setUint16(0, 1, false)
        view.setUint32(8, displayInfoSize, false)
        view.setUint32(12, jpeg.length, false)
        data.set(jpeg, displayInfoSize)

        const decoded = new NikonLiveViewDatasetCodec(createNikonRegistry(true)).decode(data)

        expect(decoded.bytesRead).toBe(data.length)
        expect(decoded.value.displayInfoSize).toBe(512)
        expect(decoded.value.liveViewImageSize).toBe(jpeg.length)
        expect(decoded.value.liveViewImage).toEqual(jpeg)
        expect(decoded.value.videoRecordingInfo).toBeUndefined()
        expect(decoded.value.imagingTemperatureStatus).toBeUndefined()
        expect(decoded.value.afFrameData.length).toBe(512 - 56)
    })

    it('bounds declared media at a nonzero offset and preserves modern recording telemetry', () => {
        const data = new Uint8Array(7 + 1024 + 4 + 9)
        const view = new DataView(data.buffer)
        view.setUint32(7 + 8, 1024, false)
        view.setUint32(7 + 12, 4, false)
        data[7 + 828] = 1
        data.set([0xff, 0xd8, 0xff, 0xd9], 7 + 1024)
        const codec = new NikonLiveViewDatasetCodec(createNikonRegistry(true))
        const decoded = codec.decode(data, 7)
        expect(decoded.value.videoRecordingInfo).toBe(1)
        expect(decoded.bytesRead).toBe(1028)
        expect(decoded.value.liveViewImage).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        expect(() => codec.decode(data.slice(0, 7 + 1026), 7)).toThrow('declared header or image')
        view.setUint32(7 + 8, 0, false)
        expect(() => codec.decode(data, 7)).toThrow('declared header or image')
        expect(() => codec.decode(data.slice(0, 15))).toThrow('incomplete header')
    })
})
