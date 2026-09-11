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
    })
})
