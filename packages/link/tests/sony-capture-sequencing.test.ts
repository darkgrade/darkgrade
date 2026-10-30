import { describe, expect, it, vi } from 'vitest'
import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'

function fixture() {
    const camera = new SonyCamera({ isLittleEndian: () => true } as any,
        new Logger({ captureConsole: false, renderInTerminal: false }))
    Object.assign(camera, { liveViewPostViewEnabled: true })
    const sent: string[] = []
    camera.set = vi.fn(async (property, value) => {
        sent.push(`${property.name}:${value}`)
        if (property.name === 'ShutterReleaseButton' && value === 'DOWN')
            (camera as any).handleEvent({ code: 0xc201, parameters: [7], transactionId: 1 })
    }) as any
    camera.send = vi.fn(async operation => operation.name === 'GetObjectInfo'
        ? { code: 0x2001, data: { objectCompressedSize: 4 } }
        : { code: 0x2001, data: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) }) as any
    return { camera, sent }
}

describe('Sony shutter and host transfer sequencing', () => {
    it('observes a host image event delivered during shutter release', async () => {
        const { camera, sent } = fixture()
        const result = await camera.captureImage({ autofocus: false })
        expect(result.data).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        expect(sent).toEqual(['ShutterHalfReleaseButton:DOWN', 'ShutterReleaseButton:DOWN',
            'ShutterReleaseButton:UP', 'ShutterHalfReleaseButton:UP'])
    })
    it('does not require a host image event for explicit card-only capture', async () => {
        const { camera } = fixture()
        camera.set = vi.fn(async () => undefined)
        expect(await camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).toEqual({})
        expect(camera.send).not.toHaveBeenCalled()
    })
    it('releases both stages even when the half-press command fails', async () => {
        const { camera } = fixture()
        camera.set = vi.fn(async (_property, value) => { if (value === 'DOWN') throw new Error('CameraBusy') }) as any
        await expect(camera.captureImage({ autofocus: false })).rejects.toThrow('CameraBusy')
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.ShutterReleaseButton, 'UP')
        expect(camera.set).toHaveBeenLastCalledWith(camera.registry.properties.ShutterHalfReleaseButton, 'UP')
    })
    it('releases the half-press even when full-shutter release fails', async () => {
        const { camera, sent } = fixture()
        camera.set = vi.fn(async (property, value) => {
            sent.push(`${property.name}:${value}`)
            if (property.name === 'ShutterReleaseButton' && value === 'UP') throw new Error('Release failed')
        }) as any
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).rejects.toThrow('Release failed')
        expect(sent.at(-1)).toBe('ShutterHalfReleaseButton:UP')
    })
})
