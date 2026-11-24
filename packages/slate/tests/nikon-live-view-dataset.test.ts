import { describe, expect, it } from 'vitest'
import { NikonLiveViewDatasetCodec } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import { createNikonRegistry } from '@ptp/registry'

describe('NikonLiveViewDatasetCodec', () => {
    it('uses the camera-declared 512-byte display-info size for older Nikon bodies', () => {
        const displayInfoSize = 512
        const jpeg = new Uint8Array(700).fill(0x5a)
        jpeg.set([0xff, 0xd8], 0)
        jpeg.set([0xff, 0xd9], jpeg.length - 2)
        const data = new Uint8Array(displayInfoSize + jpeg.length)
        const view = new DataView(data.buffer)
        view.setUint16(0, 1, false)
        view.setUint16(2, 0, false)
        view.setUint32(8, displayInfoSize, false)
        view.setUint32(12, jpeg.length, false)
        data.set(jpeg, displayInfoSize)

        const decoded = new NikonLiveViewDatasetCodec(createNikonRegistry(true)).decode(data).value

        expect(decoded.displayInfoSize).toBe(512)
        expect(decoded.liveViewImageSize).toBe(jpeg.length)
        expect(decoded.liveViewImage).toEqual(jpeg)
        expect(decoded.videoRecordingInfo).toBeUndefined()
        expect(decoded.imagingTemperatureStatus).toBeUndefined()
        expect(decoded.afFrameData.length).toBe(512 - 56)
    })

    it('accepts short legacy images without reading newer telemetry from their bytes', () => {
        const data = new Uint8Array(512 + 4)
        const view = new DataView(data.buffer)
        view.setUint32(8, 512, false)
        view.setUint32(12, 4, false)
        data.set([0xff, 0xd8, 0xff, 0xd9], 512)
        const decoded = new NikonLiveViewDatasetCodec(createNikonRegistry(true)).decode(data)
        expect(decoded.value.liveViewImage).toEqual(data.slice(512))
        expect(decoded.value.videoRecordingInfo).toBeUndefined()
        expect(decoded.bytesRead).toBe(data.length)
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
