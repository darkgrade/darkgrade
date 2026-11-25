import { Logger } from '@core/logger'
import { PTPResponseError } from '@core/ptp-errors'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { NotLiveView } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
import { describe, expect, it, vi } from 'vitest'
import { NikonCamera } from '../src/camera/nikon-camera'

/** Replies of a Nikon body that queues one ObjectAdded for the card file each release writes. */
function cardRelease(operationsSupportedRaw: number[] = []) {
    const queued: { code: number; parameters: number[] }[] = []
    return async (operation: { name: string }) => {
        if (operation.name === 'InitiateCapture' || operation.name === 'InitiateCaptureRecInMedia')
            queued.push({ code: 0x4002, parameters: [0x00010001] })
        if (operation.name === 'GetEventEx') return { code: OK.code, data: queued.splice(0) } as any
        if (operation.name === 'GetDeviceInfo') return { code: OK.code, data: { operationsSupportedRaw } } as any
        if (operation.name === 'GetObjectInfo')
            return { code: OK.code, data: { filename: 'DSC_0001.JPG', captureDate: '20261124T120000', objectCompressedSize: 4, associationType: 0, objectFormat: 0x3801 } } as any
        if (operation.name === 'GetPartialObjectEx' || operation.name === 'GetObject') return { code: OK.code, data: Uint8Array.of(1, 2, 3, 4) } as any
        return { code: OK.code } as any
    }
}

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
        vi.spyOn(camera, 'get').mockResolvedValue('OFF' as any)
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
        vi.spyOn(camera, 'get').mockResolvedValue('OFF' as any)
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

    it('fires the shutter with the default capture options and with retrieval explicitly turned off', async () => {
        for (const options of [
            undefined,
            { includeInfo: true, includeData: true },
            { includeInfo: false, includeData: false },
        ]) {
            const camera = cameraFixture()
            const send = vi.spyOn(camera, 'send').mockImplementation(cardRelease())
            vi.spyOn(camera, 'get').mockImplementation(async property =>
                property.name === 'LiveViewSelector' ? 'PHOTO' : ('OFF' as any)
            )
            const result = await camera.captureImage(options)
            expect(result.info?.filename).toBe(options?.includeInfo === false ? undefined : 'DSC_0001.JPG')
            expect(result.data?.length).toBe(options?.includeData ? 4 : undefined)
            expect(send.mock.calls.map(([operation]) => operation.name)).toContain('InitiateCapture')
        }
    })
    it('uses advertised Nikon normal release when autofocus is explicitly disabled', async () => {
        const camera = cameraFixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            property.name === 'LiveViewSelector' ? 'PHOTO' : ('OFF' as any))
        const send = vi.spyOn(camera, 'send').mockImplementation(cardRelease([0x9207]))
        await camera.captureImage({ autofocus: false })
        expect(send.mock.calls.some(([operation]) => operation.name === 'InitiateCapture')).toBe(false)
        const release = send.mock.calls.find(([operation]) => operation.name === 'InitiateCaptureRecInMedia')
        expect(release?.[1]).toEqual({ AfMode: 0xffffffff, Target: 0 })
        send.mockReset().mockImplementation(cardRelease([]))
        await expect(camera.captureImage({ autofocus: false })).rejects.toThrow('does not advertise')
        expect(send.mock.calls.some(([operation]) => operation.name === 'InitiateCaptureRecInMedia')).toBe(false)
    })
})
