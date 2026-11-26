import { PTPResponseError } from '@core/ptp-errors'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { NotLiveView } from '@vendors/nikon/definitions/nikon-response-definitions'
import { describe, expect, it, vi } from 'vitest'
import { cardObjectInfo, nikonCamera, nikonDeviceInfo } from '@tests/fixtures/nikon'
import type { Registry } from '@vendors/registry'

/** Replies of a Nikon body that queues one ObjectAdded for the card file each release writes. */
function cardRelease(registry: Registry, operationsSupportedRaw: number[] = []) {
    const queued: { code: number; parameters: number[] }[] = []
    return async (operation: { name: string }) => {
        if (operation.name === 'InitiateCapture' || operation.name === 'InitiateCaptureRecInMedia')
            queued.push({ code: 0x4002, parameters: [0x00010001] })
        if (operation.name === 'GetEventEx') return { code: OK.code, data: queued.splice(0) } as any
        if (operation.name === 'GetDeviceInfo') return { code: OK.code, data: nikonDeviceInfo(registry, operationsSupportedRaw) } as any
        if (operation.name === 'GetObjectInfo') return { code: OK.code, data: cardObjectInfo(registry, 'DSC_0001.JPG', 4) } as any
        if (operation.name === 'GetPartialObjectEx' || operation.name === 'GetObject') return { code: OK.code, data: Uint8Array.of(1, 2, 3, 4) } as any
        return { code: OK.code } as any
    }
}

const cameraFixture = () => nikonCamera({ getType: () => 'USB', disconnect: vi.fn() })

describe('Nikon live-view lifecycle', () => {
    it('does not send EndLiveView when a normal PTP session never started live view', async () => {
        const camera = cameraFixture()
        const send = vi.spyOn(camera, 'send')
        await camera.disconnect()
        expect(send).not.toHaveBeenCalled()
    })

    it('accepts a busy start response and returns the first decoded JPEG', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockResolvedValue('OFF' as any)
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.name === 'StartLiveView') return { code: DeviceBusy.code } as any
            if (operation.name === 'DeviceReady') return { code: OK.code } as any
            if (operation.name === 'GetLiveViewImageEx') return { code: OK.code, data: { liveViewImage: jpeg } } as any
            throw new Error(`Unexpected operation ${operation.name}`)
        })
        await expect(camera.captureLiveView({ includeInfo: false })).resolves.toMatchObject({ data: jpeg })
    })

    it('restarts live view when a long session receives Nikon NotLiveView (0xA00B)', async () => {
        expect(NotLiveView.code).toBe(0xa00b)
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockResolvedValue('OFF' as any)
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        let imageAttempts = 0
        const send = vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.name === 'StartLiveView' || operation.name === 'DeviceReady') return { code: OK.code } as any
            if (operation.name === 'GetLiveViewImageEx') {
                imageAttempts += 1
                const code = [NotLiveView.code, DeviceBusy.code][imageAttempts - 1]
                return (code ? { code } : { code: OK.code, data: { liveViewImage: jpeg } }) as any
            }
            throw new Error(`Unexpected operation ${operation.name}`)
        })
        await expect(camera.captureLiveView({ includeInfo: false })).resolves.toMatchObject({ data: jpeg })
        expect(send.mock.calls.filter(([operation]) => operation.name === 'StartLiveView')).toHaveLength(2)
        expect(imageAttempts).toBe(3)
    })

    it('reads an inherited live view without starting or stopping the operator’s view', async () => {
        const camera = cameraFixture()
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
        vi.spyOn(camera, 'get').mockResolvedValue('ON' as any)
        const send = vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.name === 'GetLiveViewImageEx') return { code: OK.code, data: { liveViewImage: jpeg } } as any
            throw new Error(`Unexpected operation ${operation.name}`)
        })
        await expect(camera.captureLiveView({ includeInfo: false })).resolves.toMatchObject({ data: jpeg })
        await camera.disconnect()
        expect(send.mock.calls.map(([operation]) => operation.name)).toEqual(['GetLiveViewImageEx'])
    })

    it('ends its own live view when disconnecting', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockResolvedValue('OFF' as any)
        const send = vi.spyOn(camera, 'send').mockResolvedValue({ code: OK.code } as any)
        await camera.captureLiveView({ includeData: false })
        await camera.disconnect()
        expect(send.mock.calls.filter(([operation]) => operation.name === 'EndLiveView')).toHaveLength(1)
    })

    it('refuses an unknown physical live-view state before sending activation commands', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockResolvedValue('UNKNOWN' as any)
        const send = vi.spyOn(camera, 'send')
        await expect(camera.captureLiveView({ includeData: false })).rejects.toThrow('live-view status is unknown')
        await camera.disconnect()
        expect(send).not.toHaveBeenCalled()
    })

    it('preserves a refused status read instead of attempting live-view activation', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockRejectedValue(new PTPResponseError(DeviceBusy.code, 'Status is busy'))
        const send = vi.spyOn(camera, 'send')
        await expect(camera.captureLiveView({ includeData: false })).rejects.toThrow('Status is busy')
        expect(send).not.toHaveBeenCalled()
    })

    it('retains live-view startup on older bodies that do not expose the status descriptor', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockRejectedValue(new Error('No data received from GetDevicePropDescEx'))
        const send = vi.spyOn(camera, 'send').mockResolvedValue({ code: OK.code } as any)
        await camera.captureLiveView({ includeData: false })
        expect(send.mock.calls.filter(([operation]) => operation.name === 'StartLiveView')).toHaveLength(1)
    })

    it('uses advertised Nikon normal release when autofocus is explicitly disabled', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            property.name === 'LiveViewSelector' ? 'PHOTO' : ('OFF' as any))
        const send = vi.spyOn(camera, 'send').mockImplementation(cardRelease(camera.registry, [0x9207]))
        await camera.captureImage({ autofocus: false })
        expect(send.mock.calls.some(([operation]) => operation.name === 'InitiateCapture')).toBe(false)
        const release = send.mock.calls.find(([operation]) => operation.name === 'InitiateCaptureRecInMedia')
        expect(release?.[1]).toEqual({ AfMode: 0xffffffff, Target: 0 })
        send.mockReset().mockImplementation(cardRelease(camera.registry, []))
        await expect(camera.captureImage({ autofocus: false })).rejects.toThrow('does not advertise')
        expect(send.mock.calls.some(([operation]) => operation.name === 'InitiateCaptureRecInMedia')).toBe(false)
    })
})
