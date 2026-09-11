import { Logger } from '@core/logger'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { NotLiveView } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
import { describe, expect, it, vi } from 'vitest'
import { NikonCamera } from '../src/camera/nikon-camera'

function cameraFixture(): NikonCamera {
    const transport = {
        isLittleEndian: () => true,
        isConnected: () => true,
        connect: vi.fn(),
        disconnect: vi.fn(),
        send: vi.fn(),
        receive: vi.fn(),
        classRequestReset: vi.fn(),
        getType: () => 'USB',
        on: vi.fn(),
    }
    return new NikonCamera(transport as any, new Logger({ captureConsole: false, renderInTerminal: false }))
}

describe('Nikon live-view lifecycle', () => {
    it('uses Nikon response 0xA00B for NotLiveView', () => {
        expect(NotLiveView.code).toBe(0xa00b)
    })

    it('does not send EndLiveView when a normal PTP session never started live view', async () => {
        const camera = cameraFixture()
        const send = vi.spyOn(camera, 'send')

        await camera.disconnect()

        expect(send).not.toHaveBeenCalled()
    })

    it('accepts a busy start response and returns the first decoded JPEG', async () => {
        const camera = cameraFixture()
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.name === 'StartLiveView') return { code: DeviceBusy.code } as any
            if (operation.name === 'DeviceReady') return { code: OK.code } as any
            if (operation.name === 'GetLiveViewImageEx') {
                return { code: OK.code, data: { liveViewImage: jpeg } } as any
            }
            throw new Error(`Unexpected operation ${operation.name}`)
        })

        await expect(camera.captureLiveView({ includeInfo: false })).resolves.toMatchObject({ data: jpeg })
    })

    it('restarts live view when a long session receives Nikon NotLiveView', async () => {
        const camera = cameraFixture()
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        let imageAttempts = 0
        const send = vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.name === 'StartLiveView' || operation.name === 'DeviceReady') return { code: OK.code } as any
            if (operation.name === 'GetLiveViewImageEx') {
                imageAttempts += 1
                return imageAttempts === 1
                    ? ({ code: NotLiveView.code } as any)
                    : imageAttempts === 2
                      ? ({ code: DeviceBusy.code } as any)
                      : ({ code: OK.code, data: { liveViewImage: jpeg } } as any)
            }
            throw new Error(`Unexpected operation ${operation.name}`)
        })

        await expect(camera.captureLiveView({ includeInfo: false })).resolves.toMatchObject({ data: jpeg })
        expect(send.mock.calls.filter(([operation]) => operation.name === 'StartLiveView')).toHaveLength(2)
        expect(imageAttempts).toBe(3)
    })
})
