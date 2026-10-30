import { describe, expect, it, vi } from 'vitest'
import { SonyCamera } from '@camera/sony-camera'
import { Camera } from '@camera/index'

function fixture() {
    const facade = new Camera({ vendorId: 0x054c, transport: { isLittleEndian: () => true } as any,
        logger: { captureConsole: false, renderInTerminal: false } })
    const camera = facade.getInstance() as SonyCamera
    Object.assign(camera, { liveViewPostViewEnabled: true })
    camera.refreshPropertyStates = vi.fn(async () => {
        (camera as any).propertyCache.set(0x500a, { vendorExtensions: { enabled: true } })
        return []
    })
    const sent: string[] = []
    camera.get = vi.fn(async property => property.name === 'FocusMode' ? 'AF-C' : 'CAMERA_DEVICE') as any
    camera.set = vi.fn(async (property, value) => {
        sent.push(`${property.name}:${value}`)
        if (property.name === 'ShutterReleaseButton' && value === 'DOWN') {
            (camera as any).handleEvent({ code: 0xc201, parameters: [7], transactionId: 1 });
            (camera as any).handleEvent({ code: 0xc206, parameters: [], transactionId: 1 })
        }
    }) as any
    camera.send = vi.fn(async operation => operation.name === 'GetObjectInfo'
        ? { code: 0x2001, data: { objectCompressedSize: 4 } }
        : { code: 0x2001, data: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) }) as any
    return { camera, facade, sent }
}

describe('Sony shutter and host transfer sequencing', () => {
    it('waits for fresh writable focus state before restoring autofocus after capture', async () => {
        const { camera } = fixture()
        let polls = 0
        camera.refreshPropertyStates = vi.fn(async () => {
            (camera as any).propertyCache.set(0x500a, { vendorExtensions: { enabled: ++polls > 2 } })
            return []
        })
        const original = (camera.set as any).getMockImplementation()
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'FocusMode' && value === 'AF-C') expect(polls).toBe(3)
            return original(property, value)
        }) as any
        await camera.captureImage({ autofocus: false })
        expect(polls).toBe(3)
    })
    it('explicit memory capture enables host delivery and restores the original destination', async () => {
        const { facade, sent } = fixture()
        const result = await facade.captureImage({ destination: 'memory', autofocus: false })
        expect(result.data).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        expect(sent[0]).toBe('StillImageSaveDestination:HOST_DEVICE')
        expect(sent.at(-1)).toBe('StillImageSaveDestination:CAMERA_DEVICE')
    })
    it('observes a host image event delivered during shutter release', async () => {
        const { camera, sent } = fixture()
        const result = await camera.captureImage({ autofocus: false })
        expect(result.data).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        expect(sent).toEqual(['FocusMode:Manual', 'ShutterHalfReleaseButton:DOWN', 'ShutterReleaseButton:DOWN',
            'ShutterReleaseButton:UP', 'ShutterHalfReleaseButton:UP', 'FocusMode:AF-C'])
    })
    it('does not require a host image event for explicit card-only capture', async () => {
        const { camera } = fixture()
        Object.assign(camera, { liveViewPostViewEnabled: false })
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'ShutterReleaseButton' && value === 'DOWN')
                (camera as any).handleEvent({ code: 0xc206, parameters: [], transactionId: 1 })
        }) as any
        expect(await camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).toEqual({})
        expect(camera.send).not.toHaveBeenCalled()
        expect(camera.set).not.toHaveBeenCalledWith(camera.registry.properties.SetPostViewEnable, 'ENABLE')
    })
    it('releases both stages even when the half-press command fails', async () => {
        const { camera } = fixture()
        camera.set = vi.fn(async (_property, value) => { if (value === 'DOWN') throw new Error('CameraBusy') }) as any
        await expect(camera.captureImage({ autofocus: false })).rejects.toThrow('CameraBusy')
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.ShutterReleaseButton, 'UP')
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.ShutterHalfReleaseButton, 'UP')
        expect(camera.set).toHaveBeenLastCalledWith(camera.registry.properties.FocusMode, 'AF-C')
    })
    it('releases the half-press even when full-shutter release fails', async () => {
        const { camera, sent } = fixture()
        camera.set = vi.fn(async (property, value) => {
            sent.push(`${property.name}:${value}`)
            if (property.name === 'ShutterReleaseButton' && value === 'UP') throw new Error('Release failed')
        }) as any
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).rejects.toThrow('Release failed')
        expect(sent).toContain('ShutterHalfReleaseButton:UP')
        expect(sent.at(-1)).toBe('FocusMode:AF-C')
    })
})
