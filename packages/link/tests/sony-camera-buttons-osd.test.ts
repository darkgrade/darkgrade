import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { parseOsdImageDataset } from '@ptp/datasets/vendors/sony/sony-osd-image-dataset'
import { createSonyRegistry } from '@ptp/registry'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

// Bytes captured on the darkgrade-testbench from an ILCE-6700: the Camera Remote SDK
// pressing the body's MENU button (SDIO_ControlDevice 0x9207, control code 0xd309) and
// Darkgrade reading SDIO_GetOsdImage (0x9238). The metadata block matched the SDK's
// CrOSDImageMetaInfo (osd 720x480, live view at 360,240 sized 720x480).
const MENU_PRESS = [0x02, 0x00, 0x06, 0x00]
const MENU_RELEASE = [0x01, 0x00, 0x06, 0x00]
const OSD_META_INFO = [
    0x65, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xd0, 0x02, 0x00, 0x00, 0xe0, 0x01, 0x00, 0x00, 0x68, 0x01, 0x00,
    0x00, 0xf0, 0x00, 0x00, 0x00, 0xd0, 0x02, 0x00, 0x00, 0xe0, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function osdPayload(image: number[]): Uint8Array {
    const header = new DataView(new ArrayBuffer(16))
    header.setUint32(0, 16, true)
    header.setUint32(4, image.length, true)
    header.setUint32(8, 16 + image.length, true)
    header.setUint32(12, OSD_META_INFO.length, true)
    return new Uint8Array([...new Uint8Array(header.buffer), ...image, ...OSD_META_INFO])
}

function sonyCamera() {
    const transport = { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface
    const camera = new SonyCamera(transport, new Logger({ expanded: false, captureConsole: false, renderInTerminal: false }))
    const operations: Array<{ name: string; params: unknown; data?: number[] }> = []
    const sets: Array<{ name: string; value: unknown }> = []
    camera.send = (async (operation, params, data) => {
        operations.push({ name: operation.name, params, data: data ? [...data] : undefined })
        if (operation.name === 'SDIO_GetOsdImage') return { code: 0x2001, data: osdPayload(PNG_SIGNATURE) }
        return { code: 0x2001 }
    }) as typeof camera.send
    camera.set = (async (property, value) => {
        sets.push({ name: property.name, value })
    }) as typeof camera.set
    return { camera, operations, sets }
}

describe('Sony camera buttons (CameraButtonFunction 0xd309)', () => {
    it('clicks MENU with the captured press and release payloads', async () => {
        const { camera, operations } = sonyCamera()
        await camera.pressButton('menu', { holdMilliseconds: 0 })
        expect(operations).toEqual([
            { name: 'SDIO_ControlDevice', params: { sdiControlCode: 0xd309, flagOfDevicePropertyOption: 'ENABLE' }, data: MENU_PRESS },
            { name: 'SDIO_ControlDevice', params: { sdiControlCode: 0xd309, flagOfDevicePropertyOption: 'ENABLE' }, data: MENU_RELEASE },
        ])
    })

    it('can hold a button by sending press and release separately', async () => {
        const { camera, operations } = sonyCamera()
        await camera.pressButton('enter', { action: 'press' })
        await camera.pressButton('enter', { action: 'release' })
        expect(operations.map(operation => operation.data)).toEqual([
            [0x02, 0x00, 0x05, 0x00],
            [0x01, 0x00, 0x05, 0x00],
        ])
    })

    it('rejects unknown buttons before touching the camera', async () => {
        const { camera, operations } = sonyCamera()
        await expect(camera.pressButton('shutter' as never)).rejects.toThrow('Unknown Sony camera button')
        expect(operations).toEqual([])
    })
})

describe('Sony OSD image (SDIO_GetOsdImage 0x9238)', () => {
    it('parses the captured header layout and metadata', () => {
        const dataset = parseOsdImageDataset(osdPayload(PNG_SIGNATURE), createSonyRegistry(true))
        expect(dataset.offsetToImage).toBe(16)
        expect([...dataset.image]).toEqual(PNG_SIGNATURE)
        expect(dataset.metaInfo).toEqual({
            leadingValue: 101,
            liveViewPositionExists: true,
            osdWidth: 720,
            osdHeight: 480,
            liveViewPositionX: 360,
            liveViewPositionY: 240,
            liveViewWidth: 720,
            liveViewHeight: 480,
            degree: 0,
        })
    })

    it('enables OsdImageMode once, then reads frames', async () => {
        const { camera, operations, sets } = sonyCamera()
        const first = await camera.captureOsdImage()
        await camera.captureOsdImage()
        expect([...first.image]).toEqual(PNG_SIGNATURE)
        expect(sets).toEqual([{ name: 'OsdImageMode', value: 'ON' }])
        expect(operations.map(operation => operation.name)).toEqual(['SDIO_GetOsdImage', 'SDIO_GetOsdImage'])
    })
})
