import { describe, expect, it, vi } from 'vitest'
import { NikonCamera } from '@camera/nikon-camera'
import { Logger } from '@core/logger'

function fixture(truncate = false) {
    let polls = 0
    const camera = new NikonCamera({
        isLittleEndian: () => true, isConnected: () => true, on: () => undefined,
    } as any, new Logger({ captureConsole: false, renderInTerminal: false }))
    vi.spyOn(camera, 'get').mockImplementation(async property => property.name === 'LiveViewSelector' ? 'PHOTO' : 'OFF' as any)
    const send = vi.spyOn(camera, 'send').mockImplementation(async operation => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: { operationsSupportedRaw: [0x9207, 0x941c] } } as any
        if (operation.name === 'GetEventEx') return { code: 0x2001, data: ++polls === 1 ? [] : [{ code: 0xc101, parameters: [0xffff0001] }] } as any
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: { objectCompressedSize: 4, filename: 'NEW.JPG' } } as any
        if (operation.name === 'GetPartialObjectEx') return { code: 0x2001, data: truncate ? new Uint8Array() : Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) } as any
        return { code: 0x2001 } as any
    })
    return { camera, send }
}

describe('Nikon event-identified SDRAM capture', () => {
    it('selects lossless NEF only inside Photo mode and restores compression before Movie mode', async () => {
        const { camera, send } = fixture()
        let selector = 'VIDEO', compression = 3
        const changes: unknown[] = []
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector
            : property.name === 'NikonRawCompression' ? compression : 'OFF') as any
        camera.getVendorPropertyCodes = vi.fn(async () => [0xd016])
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') selector = String(value)
            if (property.name === 'NikonRawCompression') {
                expect(selector).toBe('PHOTO')
                compression = Number(value)
                changes.push(compression)
            }
        }) as any
        const original = send.getMockImplementation()!
        send.mockImplementation(async (...args) => {
            if (args[0].name === 'GetDevicePropDescEx') return { code: 0x2001, data: {
                formFlag: 2, getSet: 'GET_SET', currentValueRaw: compression, supportedValuesRaw: [0, 3, 4],
            } } as any
            if (args[0].name === 'InitiateCaptureRecInMedia') expect(compression).toBe(0)
            return original(...args)
        })
        const result = await camera.captureImage({ destination: 'memory', autofocus: false, rawCompression: 'lossless' })
        expect(result.data?.length).toBe(4)
        expect(changes).toEqual([0, 3])
        expect(selector).toBe('VIDEO')
    })
    it('allows a card JPEG to finish processing before restoring movie mode', async () => {
        vi.useFakeTimers()
        try {
            const { camera } = fixture()
            const started = Date.now()
            camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? 'PHOTO'
                : property.name === 'MovieRecProhibitionCondition' && Date.now() - started < 7000
                    ? 'imagesInBuffer' : 'OFF') as any
            const capture = camera.captureImage({ autofocus: false })
            const result = expect(capture).resolves.toEqual({ info: undefined, data: undefined })
            await vi.advanceTimersByTimeAsync(7100)
            await result
        } finally { vi.useRealTimers() }
    })
    it('preserves a transfer failure when restoring the video pipeline also fails', async () => {
        const { camera, send } = fixture()
        let selector = 'VIDEO'
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector : 'OFF') as any
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') {
                if (value === 'VIDEO') throw new Error('video restore failed')
                selector = String(value)
            }
        }) as any
        const original = send.getMockImplementation()!
        send.mockImplementation(async (...args) => {
            if (args[0].name === 'GetPartialObjectEx') throw new Error('image transfer failed')
            return original(...args)
        })
        await expect(camera.captureImage({ destination: 'memory', autofocus: false }))
            .rejects.toThrow('image transfer failed; Error: video restore failed')
    })
    it('restarts an active video live-view pipeline as photo before releasing the shutter', async () => {
        const { camera, send } = fixture()
        let selector = 'VIDEO', pipeline: string | undefined = 'VIDEO'
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector
            : property.name === 'LiveViewStatus' ? (pipeline ? 'ON' : 'OFF') : 'OFF') as any
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') selector = String(value)
        }) as any
        const original = send.getMockImplementation()!
        send.mockImplementation(async (...args) => {
            const name = args[0].name
            if (name === 'EndLiveView') pipeline = undefined
            if (name === 'StartLiveView') pipeline = selector
            if (name === 'InitiateCaptureRecInMedia' && pipeline !== 'PHOTO') return { code: 0x200c } as any
            return original(...args)
        })
        const result = await camera.captureImage({ destination: 'memory', autofocus: false })
        expect(result.data?.length).toBe(4)
        expect(selector).toBe('VIDEO')
    })
    it('surfaces a terminal readiness error while waiting for a memory object', async () => {
        const { camera, send } = fixture()
        const original = send.getMockImplementation()!
        let released = false
        send.mockImplementation(async (...args) => {
            if (args[0].name === 'InitiateCaptureRecInMedia') released = true
            if (released && args[0].name === 'DeviceReady') return { code: 0x200c } as any
            return original(...args)
        })
        await expect(camera.captureImage({ destination: 'memory', autofocus: false })).rejects.toThrow('DeviceReady during memory capture')
        expect(send.mock.calls.some(([operation]) => operation.name === 'GetObject')).toBe(false)
    })
    it('transfers the new memory object with full metadata length and delivers its event', async () => {
        const { camera, send } = fixture()
        const event = vi.fn()
        camera.on(camera.registry.events.ObjectAddedInSdram, event)
        const result = await camera.captureImage({ destination: 'memory', autofocus: false })
        expect(result.data).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        expect(event).toHaveBeenCalledWith({ ObjectHandle: 0xffff0001 })
        expect(send.mock.calls.find(([operation]) => operation.name === 'InitiateCaptureRecInMedia')?.[1])
            .toEqual({ AfMode: 0xffffffff, Target: 1 })
        expect(send.mock.calls.some(([operation]) => ['GetStorageIDs', 'DeleteObject', 'FormatStore'].includes(operation.name))).toBe(false)
        expect(send.mock.calls.find(([operation]) => operation.name === 'GetPartialObjectEx')?.[1])
            .toEqual({ ObjectHandle: 0xffff0001, OffsetLower: 0, OffsetUpper: 0, MaxSizeLower: 4, MaxSizeUpper: 0 })
        expect(send.mock.calls.some(([operation]) => operation.name === 'GetObject')).toBe(false)
    })
    it('rejects incomplete media and refuses memory capture that would leave its image untransferred', async () => {
        const { camera, send } = fixture(true)
        await expect(camera.captureImage({ destination: 'memory' })).rejects.toThrow('empty or oversized chunk')
        send.mockClear()
        await expect(camera.captureImage({ destination: 'memory', includeData: false })).rejects.toThrow('requires transfer')
        expect(send).not.toHaveBeenCalled()
    })
})
