import { describe, expect, it, vi } from 'vitest'
import { NikonCamera } from '@camera/nikon-camera'
import { Logger } from '@core/logger'
import { TransportType } from '@transport/interfaces/transport-types'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { Registry } from '@ptp/registry'

/** A DeviceInfo reply exactly as the codec decodes it from the wire. */
function deviceInfo(registry: Registry, operationsSupportedRaw: number[]): DeviceInfo {
    const codec = new DeviceInfoCodec(registry)
    return codec.decode(
        codec.encode({
            standardVersion: 100,
            vendorExtensionID: 0x0a,
            vendorExtensionVersion: 100,
            vendorExtensionDesc: '',
            functionalMode: 0,
            operationsSupportedRaw,
            operationsSupportedDecoded: [],
            eventsSupportedRaw: [],
            eventsSupportedDecoded: [],
            devicePropertiesSupported: [],
            devicePropertiesSupportedDecoded: [],
            captureFormats: [],
            imageFormatsRaw: [],
            imageFormatsDecoded: [],
            manufacturer: 'Nikon Corporation',
            model: 'Z 5_2',
            deviceVersion: '1.00',
            serialNumber: '0001',
        })
    ).value
}

/** A card file's ObjectInfo reply exactly as the codec decodes it from the wire. */
function cardObjectInfo(registry: Registry, filename: string, size: number): ObjectInfo {
    const codec = new ObjectInfoCodec(registry)
    return codec.decode(
        codec.encode({
            storageID: 0x00010001,
            objectFormat: 0x3801,
            objectFormatDecoded: '',
            protectionStatus: 0,
            objectCompressedSize: size,
            thumbFormat: 0,
            thumbFormatDecoded: '',
            thumbCompressedSize: 0,
            thumbPixWidth: 0,
            thumbPixHeight: 0,
            imagePixWidth: 0,
            imagePixHeight: 0,
            imageBitDepth: 0,
            parentObject: 0,
            associationType: 0,
            associationDesc: 0,
            sequenceNumber: 0,
            filename,
            captureDate: '20261124T120000',
            modificationDate: '20261124T120000',
            keywords: '',
        })
    ).value
}

const rawCompressionNames: Record<number, string> = { 0: 'Lossless', 3: 'High efficiency★', 4: 'High efficiency' }

/** Nikon queues ObjectAdded (card) or ObjectAddedInSdram (memory) for each release, read by GetEventEx. */
function fixture(truncate = false, transportType = TransportType.USB) {
    const queued: { code: number; parameters: number[] }[] = []
    const camera = new NikonCamera({
        isLittleEndian: () => true, isConnected: () => true, on: () => undefined, getType: () => transportType,
    } as any, new Logger({ captureConsole: false, renderInTerminal: false }))
    vi.spyOn(camera, 'get').mockImplementation(async property => property.name === 'LiveViewSelector' ? 'PHOTO' : 'OFF' as any)
    const send = vi.spyOn(camera, 'send').mockImplementation(async (operation, parameters) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera.registry, [0x9207, 0x941c]) } as any
        if (operation.name === 'InitiateCaptureRecInMedia' || operation.name === 'InitiateCapture')
            queued.push((parameters as { Target?: number } | undefined)?.Target === 1
                ? { code: 0xc101, parameters: [0xffff0001] } : { code: 0x4002, parameters: [0x00010001] })
        if (operation.name === 'GetEventEx') return { code: 0x2001, data: queued.splice(0) } as any
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: cardObjectInfo(camera.registry, 'NEW.JPG', 4) } as any
        if (operation.name === 'GetPartialObjectEx') return { code: 0x2001, data: truncate ? new Uint8Array() : Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) } as any
        return { code: 0x2001 } as any
    })
    return { camera, send }
}

describe('Nikon event-identified SDRAM capture', () => {
    it('retains remote Wi-Fi ownership after a still and never resets the link to PC camera mode', async () => {
        const {camera, send} = fixture(false, TransportType.IP)
        let selector = 'VIDEO'
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector : 'OFF') as any
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') selector = String(value)
        }) as any
        await camera.captureImage({destination: 'memory', autofocus: false})
        expect(selector).toBe('VIDEO')
        expect(send.mock.calls.filter(([operation]) => operation.name === 'ChangeCameraMode').map(([, parameters]) => parameters))
            .toEqual([{Mode: 'REMOTE'}])
        // A second operation stays in the same remote session.
        await camera.captureImage({destination: 'memory', autofocus: false})
        expect(send.mock.calls.filter(([operation]) => operation.name === 'ChangeCameraMode')).toHaveLength(1)
    })
    it('selects lossless NEF only inside Photo mode and restores compression before Movie mode', async () => {
        const { camera, send } = fixture()
        let selector = 'VIDEO', compression = 3
        const changes: unknown[] = []
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector
            : property.name === 'NikonRawCompression' ? rawCompressionNames[compression] : 'OFF') as any
        camera.getVendorPropertyCodes = vi.fn(async () => [0xd016])
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') selector = String(value)
            if (property.name === 'NikonRawCompression') {
                expect(selector).toBe('PHOTO')
                compression = Number(Object.keys(rawCompressionNames).find(key => rawCompressionNames[Number(key)] === value))
                changes.push(compression)
            }
        }) as any
        const original = send.getMockImplementation()!
        send.mockImplementation(async (...args) => {
            if (args[0].name === 'GetDevicePropDescEx') return { code: 0x2001, data: {
                formFlag: 2, getSet: 'GET_SET', currentValueRaw: compression, supportedValuesRaw: [0, 3, 4],
                supportedValuesDecoded: [0, 3, 4].map(code => rawCompressionNames[code]),
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
            const result = expect(capture).resolves.toMatchObject({ info: { filename: 'NEW.JPG' }, data: undefined })
            await vi.advanceTimersByTimeAsync(7100)
            await result
        } finally { vi.useRealTimers() }
    })
    it.each(['card', 'memory'] as const)('waits for silent capture processing before RAW and video restoration (%s)', async destination => {
        const { camera, send } = fixture()
        let selector = 'VIDEO', compression = 3, released = false, silentPolls = 0, ready = false
        camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector
            : property.name === 'NikonRawCompression' ? rawCompressionNames[compression] : 'OFF') as any
        camera.getVendorPropertyCodes = vi.fn(async () => [0xd016])
        camera.set = vi.fn(async (property, value) => {
            if (property.name === 'LiveViewSelector') {
                if (value === 'VIDEO') expect(ready).toBe(true)
                selector = String(value)
            }
            if (property.name === 'NikonRawCompression') {
                if (released) expect(ready).toBe(true)
                expect(selector).toBe('PHOTO')
                compression = Number(Object.keys(rawCompressionNames).find(key => rawCompressionNames[Number(key)] === value))
            }
        }) as any
        const original = send.getMockImplementation()!
        send.mockImplementation(async (...args) => {
            if (args[0].name === 'GetDevicePropDescEx') return { code: 0x2001, data: {
                formFlag: 2, getSet: 'GET_SET', currentValueRaw: compression, supportedValuesRaw: [0, 3, 4],
                supportedValuesDecoded: [0, 3, 4].map(code => rawCompressionNames[code]),
            } } as any
            if (args[0].name === 'InitiateCaptureRecInMedia') released = true
            if (args[0].name === 'DeviceReady' && released) {
                if (silentPolls++ < 2) return { code: 0xa201 } as any
                ready = true
            }
            return original(...args)
        })
        await camera.captureImage({ destination, autofocus: false, rawCompression: 'lossless' })
        expect(silentPolls).toBeGreaterThanOrEqual(3)
        expect(compression).toBe(3)
        expect(selector).toBe('VIDEO')
        expect(send.mock.calls.filter(([operation]) => operation.name === 'InitiateCaptureRecInMedia')).toHaveLength(1)
    })
    it('bounds a silent capture that never becomes ready without releasing the shutter twice', async () => {
        vi.useFakeTimers()
        try {
            const { camera, send } = fixture()
            const original = send.getMockImplementation()!
            let released = false
            send.mockImplementation(async (...args) => {
                if (args[0].name === 'InitiateCaptureRecInMedia') released = true
                if (released && args[0].name === 'DeviceReady') return { code: 0xa201 } as any
                return original(...args)
            })
            const result = expect(camera.captureImage({ autofocus: false })).rejects.toThrow('timed out')
            await vi.advanceTimersByTimeAsync(60100)
            await result
            expect(send.mock.calls.filter(([operation]) => operation.name === 'InitiateCaptureRecInMedia')).toHaveLength(1)
        } finally { vi.useRealTimers() }
    })
    it('allows a 30-second still exposure to complete readout before restoring movie mode', async () => {
        vi.useFakeTimers()
        try {
            const { camera, send } = fixture()
            let selector = 'VIDEO', releasedAt: number | undefined, ready = false
            camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector : 'OFF') as any
            camera.set = vi.fn(async (property, value) => {
                if (property.name === 'LiveViewSelector') {
                    if (value === 'VIDEO') expect(ready).toBe(true)
                    selector = String(value)
                }
            }) as any
            const original = send.getMockImplementation()!
            send.mockImplementation(async (...args) => {
                if (args[0].name === 'InitiateCaptureRecInMedia') releasedAt = Date.now()
                if (args[0].name === 'DeviceReady' && releasedAt !== undefined) {
                    if (Date.now() - releasedAt < 31500) return { code: 0xa201 } as any
                    ready = true
                }
                return original(...args)
            })
            const result = expect(camera.captureImage({ autofocus: false }))
                .resolves.toMatchObject({ info: { filename: 'NEW.JPG' }, data: undefined })
            await vi.advanceTimersByTimeAsync(32000)
            await result
            expect(selector).toBe('VIDEO')
            expect(send.mock.calls.filter(([operation]) => operation.name === 'InitiateCaptureRecInMedia')).toHaveLength(1)
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
