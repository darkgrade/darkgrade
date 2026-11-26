import { Camera } from '@camera/index'
import { protocolSession } from '@camera/protocol-session'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { canonEvents, canonObjectAdded } from '@tests/fixtures/canon-events'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    vi.useRealTimers()
})

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined }) as unknown as TransportInterface

/** A simulated EOS body: the release announces its files through ObjectAddedEx, read with GetEvent. */
function fixture(
    options: { noNewImage?: boolean; staleImage?: boolean; shortTransfer?: boolean; delayed?: boolean; oversize?: boolean; slowEvents?: boolean } = {}
) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const data = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const files = new Map([
        [2, 'IMG_0002.CR3'],
        [4, 'IMG_0002.JPG'],
    ])
    const queued: Uint8Array[] = options.staleImage ? [canonObjectAdded(1, 'IMG_0001.JPG', data.length)] : []
    let polls = 0
    const shutters: string[] = []
    const downloads: number[] = []
    const objectInfo = (handle: number): ObjectInfo => {
        const codec = new ObjectInfoCodec(driver.registry)
        const filename = files.get(handle) ?? 'IMG_0001.JPG'
        return codec.decode(
            codec.encode({
                storageID: 0x00010001,
                objectFormat: 0x3801,
                objectFormatDecoded: '',
                protectionStatus: 0,
                objectCompressedSize: options.oversize ? 101 * 1024 * 1024 : data.length,
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
                captureDate: '',
                modificationDate: '',
                keywords: '',
            })
        ).value
    }
    vi.spyOn(driver, 'listUnknownPropertyStates').mockReturnValue([])
    vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition, parameters: Record<string, number>) => {
        if (operation.name === 'CanonGetEventData') {
            // A delayed body announces its files one poll later.
            if (options.delayed && polls++ < 2) return { code: 0x2001, data: canonEvents(driver.registry, []) }
            // GetEvent is destructive: the records leave the camera's queue when it is read.
            const records = queued.splice(0)
            if (options.slowEvents && records.length) await new Promise(resolve => setTimeout(resolve, 100))
            return { code: 0x2001, data: canonEvents(driver.registry, records) }
        }
        if (operation.name === 'CanonRemoteReleaseOn') {
            shutters.push(String(parameters.ReleaseMode))
            if (String(parameters.ReleaseMode) === 'SHUTTER' && !options.noNewImage)
                queued.push(canonObjectAdded(2, 'IMG_0002.CR3', 8), canonObjectAdded(4, 'IMG_0002.JPG', data.length))
        }
        if (operation.name === 'GetObjectInfo') {
            expect(parameters.ObjectHandle).toBe(4)
            return { code: 0x2001, data: objectInfo(parameters.ObjectHandle!) }
        }
        if (operation.name === 'GetObjectHandles' || operation.name === 'GetStorageIDs')
            throw new Error('A capture is confirmed by its event, never by scanning the card')
        return { code: 0x2001, parameters: [] }
    }) as never)
    vi.spyOn(driver, 'getObject').mockImplementation(async handle => {
        downloads.push(handle)
        return options.shortTransfer ? data.slice(0, 2) : data
    })
    return { driver, data, info: objectInfo(4), shutters, downloads }
}

it.each([
    { includeInfo: true, includeData: true },
    { includeInfo: false, includeData: true },
    { includeInfo: true, includeData: false },
])('returns only requested media from the announced still, preferring the JPEG (%j)', async options => {
    const test = fixture({ delayed: true })
    const result = test.driver.captureImage({ autofocus: false, ...options })
    const assertion = expect(result).resolves.toEqual({
        ...(options.includeInfo ? { info: test.info } : {}),
        ...(options.includeData ? { data: test.data } : {}),
        objectHandle: 4,
    })
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual(options.includeData ? [4] : [])
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
})

it('keeps the files a background poll read while a capture paused polling', async () => {
    // The poll already in flight when the capture pauses polling holds the release's ObjectAddedEx.
    const test = fixture({ slowEvents: true })
    const polling = test.driver as unknown as { startPolling(): void; stopPolling(): Promise<void> }
    polling.startPolling()
    const result = test.driver.captureImage({ autofocus: false })
    const assertion = expect(result).resolves.toMatchObject({ objectHandle: 4, data: test.data })
    await vi.advanceTimersByTimeAsync(10_000)
    await assertion
    const stopped = polling.stopPolling()
    await vi.advanceTimersByTimeAsync(1_000)
    await stopped
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
})

it('does not claim a file announced before the release', async () => {
    const test = fixture({ staleImage: true, noNewImage: true })
    const assertion = expect(test.driver.captureImage({ autofocus: false })).rejects.toThrow('no new still image')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual([])
})

it('rejects a truncated transfer without firing the shutter again', async () => {
    const test = fixture({ shortTransfer: true })
    const assertion = expect(test.driver.captureImage({ autofocus: false })).rejects.toThrow('transfer length')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
    expect(test.downloads).toEqual([4])
})

it('rejects an oversized image before allocating or downloading its bytes', async () => {
    const test = fixture({ oversize: true })
    const assertion = expect(test.driver.captureImage({ autofocus: false })).rejects.toThrow('transfer bound')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual([])
})

it('reads the handle of ObjectAddedEx and ObjectAddedEx64 records at libgphoto2’s offset', () => {
    const { driver } = fixture()
    const ex64 = new DataView(new ArrayBuffer(0x2c + 13))
    ex64.setUint32(0, 0x2c + 13, true)
    ex64.setUint32(4, 0xc1a7, true)
    ex64.setUint32(0x08, 7, true)
    ex64.setUint32(0x0c, 0x00020001, true)
    ex64.setUint16(0x10, 0xb982, true)
    ex64.setUint32(0x1c, 123, true)
    new Uint8Array(ex64.buffer).set(new TextEncoder().encode('MVI_0007.MP4'), 0x2c)
    const [added, added64] = canonEvents(driver.registry, [canonObjectAdded(5, 'IMG_0005.CR3', 99), new Uint8Array(ex64.buffer)])
    expect(added!.object).toEqual({ handle: 5 })
    expect(added64!.object).toEqual({ handle: 7 })
    // A record with no object handle stays opaque rather than inventing a file.
    const short = new DataView(new ArrayBuffer(16))
    short.setUint32(0, 16, true)
    short.setUint32(4, 0xc181, true)
    expect(canonEvents(driver.registry, [new Uint8Array(short.buffer)])[0]!.object).toBeUndefined()
})
