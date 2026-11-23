import { Camera } from '@camera/index'
import { CanonCamera } from '@camera/canon-camera'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function fixture(options: { noNewImage?: boolean; invalidBaseline?: boolean; shortTransfer?: boolean; busyIndex?: boolean; pendingFile?: boolean; oversize?: boolean } = {}) {
    const camera = new Camera({
        vendorId: 0x04a9,
        transport: { isLittleEndian: () => true, on: () => undefined } as any,
        logger: { captureConsole: false, renderInTerminal: false },
    })
    const instance = camera.getInstance() as CanonCamera
    const data = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const info = { filename: 'new.jpg', objectCompressedSize: data.length, associationType: 0 }
    let captured = false, indexBusy = options.busyIndex, pendingFile = options.pendingFile
    const shutters: string[] = [], downloads: number[] = []
    vi.spyOn(camera, 'getCanonUnknownPropertyStates').mockResolvedValue([])
    instance.send = (async (operation: any, parameters: any) => {
        if (operation.name === 'GetStorageIDs') return { code: 0x2001, data: [0x10000, 0x10001] }
        if (operation.name === 'GetObjectHandles') {
            expect(parameters.StorageID).toBe(0x10001)
            if (options.invalidBaseline) return { code: 0x2001 }
            if (captured && indexBusy) { indexBusy = false; return { code: 0x2019 } }
            if (captured && !options.noNewImage)
                return { code: 0x2001, data: options.pendingFile ? [1, 4] : [1, 2, 3, 4] }
            return { code: 0x2001, data: [1] }
        }
        if (operation.name === 'CanonRemoteReleaseOn') {
            shutters.push(parameters.ReleaseMode)
            if (parameters.ReleaseMode === 'SHUTTER') captured = true
        }
        if (operation.name === 'GetObjectInfo') {
            expect(parameters.ObjectHandle).not.toBe(1)
            if (pendingFile) { pendingFile = false; return { code: 0x2001, data: { ...info, objectCompressedSize: 0 } } }
            if (options.oversize) return { code: 0x2001, data: { ...info, objectCompressedSize: 101 * 1024 * 1024 } }
            return { code: 0x2001, data: { ...info, filename:
                parameters.ObjectHandle === 2 ? 'new.cr3' : parameters.ObjectHandle === 3 ? 'folder' : 'new.jpg',
                associationType: parameters.ObjectHandle === 3 ? 1 : 0 } }
        }
        return { code: 0x2001 }
    }) as any
    vi.spyOn(instance, 'getObject').mockImplementation(async handle => {
        downloads.push(handle)
        return options.shortTransfer ? data.slice(0, 2) : data
    })
    return { camera, instance, data, info, shutters, downloads }
}

it.each([
    { includeInfo: true, includeData: true },
    { includeInfo: false, includeData: true },
    { includeInfo: true, includeData: false },
])('returns only requested media from a new still, preferring the indexed JPEG (%j)', async options => {
    const test = fixture({ busyIndex: true })
    const result = test.camera.captureImage({ autofocus: false, ...options })
    const assertion = expect(result).resolves.toEqual({
        ...(options.includeInfo ? { info: test.info } : {}),
        ...(options.includeData ? { data: test.data } : {}),
    })
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual(options.includeData ? [4] : [])
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
})

it('rejects an acknowledged shutter that produces no new still without downloading an old image', async () => {
    const test = fixture({ noNewImage: true })
    const assertion = expect(test.camera.captureImage({ autofocus: false })).rejects.toThrow('no new still image')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual([])
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
})

it('rejects an unreadable baseline before pressing the shutter', async () => {
    const test = fixture({ invalidBaseline: true })
    await expect(test.camera.captureImage({ autofocus: false })).rejects.toThrow('no object dataset')
    expect(test.shutters).toEqual([])
})

it('rejects a truncated transfer without firing the shutter again', async () => {
    const test = fixture({ shortTransfer: true })
    const assertion = expect(test.camera.captureImage({ autofocus: false })).rejects.toThrow('transfer length')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
    expect(test.downloads).toEqual([4])
})

it('waits for a newly indexed still to finish writing without another shutter command', async () => {
    const test = fixture({ pendingFile: true })
    const assertion = expect(test.camera.captureImage({ autofocus: false })).resolves.toMatchObject({ data: test.data })
    await vi.runAllTimersAsync()
    await assertion
    expect(test.shutters).toEqual(['FOCUS', 'SHUTTER'])
})

it('rejects an oversized image before allocating or downloading its bytes', async () => {
    const test = fixture({ oversize: true })
    const assertion = expect(test.camera.captureImage({ autofocus: false })).rejects.toThrow('transfer bound')
    await vi.runAllTimersAsync()
    await assertion
    expect(test.downloads).toEqual([])
})
