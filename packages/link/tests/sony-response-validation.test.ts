import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import type { SonyDevicePropDesc } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

function cameraFixture() {
    const transport = { isLittleEndian: () => true, isConnected: () => true } as unknown as TransportInterface
    const camera = new SonyCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
    const sent: string[] = []
    const replies: Array<{ code: number; data?: unknown }> = []
    camera.send = (async operation => {
        sent.push(operation.name)
        return replies.shift() ?? { code: 0x2001 }
    }) as typeof camera.send
    camera.set = vi.fn(async () => undefined)
    return { camera, sent, replies }
}

describe('Sony session response validation', () => {
    it('allows an inventory session without changing host priority or save destination', async () => {
        const { camera, sent } = cameraFixture()
        camera.refreshPropertyStates = async () => []
        await camera.connect(undefined, { configure: false })
        expect(sent).toEqual([
            'SDIO_OpenSession',
            'SDIO_Connect',
            'SDIO_Connect',
            'SDIO_GetExtDeviceInfo',
            'SDIO_Connect',
        ])
        expect(camera.set).not.toHaveBeenCalled()
    })

    it('stops before authentication or configuration if the camera refuses the session', async () => {
        const { camera, replies, sent } = cameraFixture()
        replies.push({ code: 0x2019 })
        await expect(camera.connect()).rejects.toMatchObject({ code: 0x2019 })
        expect(sent).toEqual(['SDIO_OpenSession'])
        expect(camera.set).not.toHaveBeenCalled()
    })

    it('preserves a refusal when an existing session cannot be closed', async () => {
        const { camera, replies, sent } = cameraFixture()
        replies.push({ code: 0x201e }, { code: 0x200f })
        await expect(camera.connect()).rejects.toMatchObject({ code: 0x200f })
        expect(sent).toEqual(['SDIO_OpenSession', 'CloseSession'])
    })

    it.each([1, 2, 3, 4])('stops at failed handshake step %i', async failedStep => {
        const { camera, replies, sent } = cameraFixture()
        replies.push(...Array.from({ length: failedStep }, () => ({ code: 0x2001 })), { code: 0x200f })
        await expect(camera.connect()).rejects.toMatchObject({ code: 0x200f })
        expect(sent).toHaveLength(failedStep + 1)
        expect(camera.set).not.toHaveBeenCalled()
    })
})

describe('Sony authoritative property refresh', () => {
    it('stops remote image delivery before switching from capture to card enumeration', async () => {
        const { camera, replies, sent } = cameraFixture()
        Object.assign(camera, { liveViewPostViewEnabled: true })
        const property = camera.registry.properties.ContentTransferEnable
        replies.push({ code: 0x2001 }, { code: 0x2001, data: { properties: [{
            devicePropertyCode: property.code, currentValueRaw: 1, currentValueDecoded: 'ENABLE',
            vendorExtensions: { enabled: true }, getSet: 'GET',
        }] } })
        await camera.prepareStorageRead()
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.SetLiveViewEnable, 'DISABLE')
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.SetPostViewEnable, 'DISABLE')
        expect(sent).toEqual(['SDIO_SetContentsTransferMode', 'SDIO_GetAllExtDevicePropInfo'])
    })

    it('retains the reserved Sony change-notification word and still accepts an empty legacy notification', () => {
        const { camera } = cameraFixture()
        const listener = vi.fn()
        camera.on(camera.registry.events.SDIE_DevicePropChanged, listener)
        ;(camera as any).handleEvent({ code: 0xc203, parameters: [0], transactionId: 1 })
        expect(listener).toHaveBeenLastCalledWith({ Reserved: 0 })
        ;(camera as any).handleEvent({ code: 0xc203, parameters: [], transactionId: 2 })
        expect(listener).toHaveBeenLastCalledWith({})
    })

    it('reads fresh values from bulk inventory without issuing an unadvertised individual read', async () => {
        const { camera, replies, sent } = cameraFixture()
        const property = camera.registry.properties.ContentTransferEnable
        Object.assign(camera, { contentTransferModeEnabled: true })
        replies.push({ code: 0x2001, data: { properties: [{
            devicePropertyCode: property.code, currentValueRaw: 1, currentValueDecoded: 'ENABLE',
            vendorExtensions: { enabled: true }, getSet: 'GET',
        }] } })
        expect(await camera.get(property)).toBe('ENABLE')
        expect(sent).toEqual(['SDIO_GetAllExtDevicePropInfo'])
        replies.push({ code: 0x2001, data: { properties: [] } })
        await expect(camera.get(property)).rejects.toThrow('not advertised')
    })

    it('removes controls absent from the next full inventory and retains the last valid inventory after a refusal', async () => {
        const { camera, replies } = cameraFixture()
        const property = {
            devicePropertyCode: 0xd309,
            currentValueRaw: 1,
            currentValueDecoded: 1,
            vendorExtensions: { enabled: true },
            getSet: 'GET_SET',
        } as SonyDevicePropDesc
        replies.push({ code: 0x2001, data: { properties: [property] } })
        expect((await camera.refreshPropertyStates()).map(entry => entry.code)).toEqual([0xd309])
        replies.push({ code: 0x2019 })
        await expect(camera.refreshPropertyStates()).rejects.toMatchObject({ code: 0x2019 })
        expect(camera.listPropertyStates().map(entry => entry.code)).toEqual([0xd309])
        replies.push({ code: 0x2001, data: { properties: [] } })
        expect(await camera.refreshPropertyStates()).toEqual([])
    })
})

describe('Sony preview results', () => {
    it('waits for advertised live-view readiness before requesting the image', async () => {
        const { camera, replies, sent } = cameraFixture()
        const status = (value: number) => ({
            devicePropertyCode: 0xd221, currentValueRaw: value, currentValueDecoded: value,
            vendorExtensions: { enabled: true }, getSet: 'GET',
        } as SonyDevicePropDesc)
        replies.push({ code: 0x2001, data: { properties: [status(0)] } })
        await camera.refreshPropertyStates()
        const bytes = new Uint8Array(28)
        new DataView(bytes.buffer).setUint32(0, 24, true)
        new DataView(bytes.buffer).setUint32(4, 4, true)
        bytes.set([0xff, 0xd8, 0xff, 0xd9], 24)
        replies.push({ code: 0x2001, data: { properties: [status(1)] } }, { code: 0x2001, data: bytes })
        expect((await camera.captureLiveView({ includeInfo: false })).data).toEqual(bytes.slice(24))
        expect(sent.slice(-2)).toEqual(['SDIO_GetAllExtDevicePropInfo', 'GetObject'])
    })

    it('does not request an image when the camera reports live view unsupported', async () => {
        const { camera, replies, sent } = cameraFixture()
        const status = { devicePropertyCode: 0xd221, currentValueRaw: 2, vendorExtensions: { enabled: true }, getSet: 'GET' } as SonyDevicePropDesc
        replies.push({ code: 0x2001, data: { properties: [status] } })
        await camera.refreshPropertyStates()
        replies.push({ code: 0x2001, data: { properties: [status] } })
        await expect(camera.captureLiveView({ includeInfo: false })).rejects.toThrow('unavailable')
        expect(sent).not.toContain('GetObject')
    })

    it('preserves the camera refusal rather than decoding the response words as an image', async () => {
        const { camera, replies } = cameraFixture()
        replies.push({ code: 0x200f, data: new Uint8Array(4) })
        await expect(camera.captureLiveView({ includeInfo: false })).rejects.toMatchObject({ code: 0x200f })
    })

    it.each([undefined, new Uint8Array(), new Uint8Array(16)])(
        'rejects successful responses without image bytes',
        async data => {
            const { camera, replies } = cameraFixture()
            replies.push({ code: 0x2001, data })
            await expect(camera.captureLiveView({ includeInfo: false })).rejects.toThrow(/no (dataset|image)/)
        }
    )

    it('extracts the image from the camera-declared offset', async () => {
        const { camera, replies } = cameraFixture()
        const bytes = new Uint8Array(28)
        const header = new DataView(bytes.buffer)
        header.setUint32(0, 24, true)
        header.setUint32(4, 4, true)
        bytes.set([0xff, 0xd8, 0xff, 0xd9], 24)
        replies.push({ code: 0x2001, data: bytes })
        expect((await camera.captureLiveView({ includeInfo: false })).data).toEqual(bytes.slice(24))
    })
})

describe('Sony partial downloads', () => {
    it.each([
        { code: 0x2001, data: new Uint8Array() },
        { code: 0x2001, data: new Uint8Array(6) },
        { code: 0x200f, data: new Uint8Array(4) },
    ])('rejects incomplete or refused transfers without retrying forever', async reply => {
        const { camera, replies, sent } = cameraFixture()
        Object.assign(camera, { contentTransferModeEnabled: true })
        replies.push(reply)
        await expect(camera.getObject(7, 5)).rejects.toThrow()
        expect(sent).toEqual(['SDIO_GetPartialLargeObject'])
    })

    it('joins partial chunks until the advertised object size has arrived', async () => {
        const { camera, replies } = cameraFixture()
        Object.assign(camera, { contentTransferModeEnabled: true })
        replies.push({ code: 0x2001, data: Uint8Array.of(1, 2) }, { code: 0x2001, data: Uint8Array.of(3, 4, 5) })
        expect(await camera.getObject(7, 5)).toEqual(Uint8Array.of(1, 2, 3, 4, 5))
    })
})
