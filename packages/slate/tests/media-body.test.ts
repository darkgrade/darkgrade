/**
 * Card, media, battery, clock, camera information and events on simulated Sony, Canon, Nikon and
 * generic PTP bodies. Replies are encoded with the real codecs (DeviceInfo, StorageInfo,
 * ObjectInfo, Sony property inventories and content lists, Canon and Nikon event records), and each
 * vendor covers a confirmed result, a refusal, an unsupported case and, for writes, an unknown
 * outcome.
 */
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import { readCameraObjectHandles } from '@vendors/generic/storage'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfoCodec } from '@ptp/datasets/storage-info-dataset'
import { CanonEventDataCodec } from '@vendors/canon/datasets/canon-event-data-dataset'
import { canonEvents, canonObjectAdded, canonValue } from '@tests/fixtures/canon-events'
import { SDIDevicePropInfoArrayCodec } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import type { Registry } from '@vendors/registry'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { decodeMediaId, encodeMediaId } from '@vendors/generic/media-id'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
import { SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { concatenate, encodedDeviceInfo, encodedObjectInfo } from '@tests/fixtures/camera-fixtures'
import { sonyContentList } from '@tests/fixtures/sony-content-list'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

type Send = (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) => Promise<{ code: number; data?: unknown }>

function simulatedTransport(type = TransportType.USB) {
    let deliver: ((event: PTPEvent) => void) | undefined
    const transport = {
        isLittleEndian: () => true,
        isConnected: () => true,
        getType: () => type,
        on: (handler: (event: PTPEvent) => void) => {
            deliver = handler
        },
    } as unknown as TransportInterface
    return { transport, emit: (event: PTPEvent) => deliver?.(event) }
}

const deviceInfo = (
    registry: Registry,
    { manufacturer, model, firmware }: { manufacturer: string; model: string; firmware: string },
    devicePropertiesSupported: number[],
    operationsSupportedRaw: number[]
): DeviceInfo =>
    encodedDeviceInfo(registry, {
        operationsSupportedRaw,
        devicePropertiesSupported,
        manufacturer,
        model,
        deviceVersion: firmware,
        serialNumber: '0001',
    })

interface CardFile {
    handle: number
    storageId: number
    name: string
    bytes: Uint8Array
    captureDate: string
    thumbnail?: Uint8Array
    /** What ObjectInfo reports, when it differs from the real length (0xffffffff over 4 GiB). */
    reportedSize?: number
    folder?: boolean
}

function objectInfo(registry: Registry, file: CardFile): ObjectInfo {
    return encodedObjectInfo(registry, {
        storageID: file.storageId,
        objectFormat: file.folder ? 0x3001 : 0x3801,
        objectCompressedSize: file.reportedSize ?? file.bytes.length,
        thumbFormat: file.thumbnail ? 0x3801 : 0,
        thumbCompressedSize: file.thumbnail?.length ?? 0,
        thumbPixWidth: file.thumbnail ? 160 : 0,
        thumbPixHeight: file.thumbnail ? 120 : 0,
        imagePixWidth: file.folder ? 0 : 6000,
        imagePixHeight: file.folder ? 0 : 4000,
        imageBitDepth: 24,
        associationType: file.folder ? 1 : 0,
        filename: file.name,
        captureDate: file.captureDate,
        modificationDate: file.captureDate,
    })
}

function storageInfo(registry: Registry, freeBytes: number, freeImages: number) {
    const codec = new StorageInfoCodec(registry)
    return codec.decode(
        codec.encode({
            storageType: 4,
            filesystemType: 2,
            accessCapability: 0,
            maxCapacity: 64_000_000_000n,
            freeSpaceInBytes: BigInt(freeBytes),
            freeSpaceInImages: freeImages,
            storageDescription: 'SD',
            volumeLabel: '',
        })
    ).value
}

/** A standard DevicePropDesc for one property, decoded by the real codec. */
function descriptor(registry: Registry, code: number, type: number, value: number | string, writable: boolean) {
    const encode = (current: number | string) =>
        type === 0xffff ? registry.codecs.string.encode(String(current)) : registry.codecs.uint8.encode(Number(current))
    const wire = concatenate([
        registry.codecs.uint16.encode(code),
        registry.codecs.uint16.encode(type),
        Uint8Array.of(writable ? 1 : 0),
        encode(value),
        encode(value),
        Uint8Array.of(0),
    ])
    return new DevicePropDescCodec(registry).decode(wire).value
}

const jpeg = (marker: number) => Uint8Array.of(0xff, 0xd8, marker, 0xff, 0xd9)

/** The card and clock of a standard PTP body; each vendor adds its own replies on top. */
function standardCard(
    registry: Registry,
    options: { identity: { manufacturer: string; model: string; firmware: string }; clock?: boolean; thumbnails?: boolean }
) {
    const files: CardFile[] = [
        { handle: 0x01, storageId: 0x00010001, name: 'DCIM', bytes: new Uint8Array(), captureDate: '', folder: true },
        { handle: 0x11, storageId: 0x00010001, name: 'IMG_0001.JPG', bytes: jpeg(1), captureDate: '20261124T091500', thumbnail: jpeg(0x51) },
        { handle: 0x12, storageId: 0x00010001, name: 'IMG_0002.CR3', bytes: Uint8Array.of(1, 2, 3, 4, 5, 6, 7), captureDate: '20261124T091510' },
        { handle: 0x13, storageId: 0x00010001, name: 'MVI_0003.MP4', bytes: Uint8Array.of(9, 9, 9), captureDate: '20261124T091505' },
    ]
    const state = {
        clock: '20260101T000000',
        clockApplies: true,
        clockWritable: true,
        clockResponse: 0x2001,
        refuseThumbnails: false,
        refuseDownloads: false,
        downloads: [] as number[],
    }
    const send: Send = async (operation, parameters, data) => {
        switch (operation.name) {
            case 'GetDeviceInfo':
                return {
                    code: 0x2001,
                    data: deviceInfo(
                        registry,
                        options.identity,
                        options.clock === false ? [0x5001] : [0x5001, 0x5011],
                        options.thumbnails === false ? [0x1001, 0x1009] : [0x1001, 0x1009, 0x100a]
                    ),
                }
            case 'GetStorageIDs':
                // The second entry is an empty slot's placeholder.
                return { code: 0x2001, data: [0x00010001, 0x00020000] }
            case 'GetStorageInfo':
                return { code: 0x2001, data: storageInfo(registry, 32_000_000_000, 1250) }
            case 'GetObjectHandles':
                return {
                    code: 0x2001,
                    data: files.filter(file => file.storageId === parameters.StorageID).map(file => file.handle),
                }
            case 'GetObjectInfo': {
                const file = files.find(candidate => candidate.handle === parameters.ObjectHandle)
                return file ? { code: 0x2001, data: objectInfo(registry, file) } : { code: 0x2009 }
            }
            case 'GetThumb': {
                if (state.refuseThumbnails) return { code: 0x2019 }
                const file = files.find(candidate => candidate.handle === parameters.ObjectHandle)
                return file?.thumbnail ? { code: 0x2001, data: file.thumbnail } : { code: 0x2009 }
            }
            case 'GetPartialObject':
            case 'GetPartialObjectEx': {
                const file = files.find(candidate => candidate.handle === parameters.ObjectHandle)
                if (!file) return { code: 0x2009 }
                if (state.refuseDownloads) return { code: 0x2019 }
                state.downloads.push(file.handle)
                const offset = Number(parameters.Offset ?? parameters.OffsetLower)
                const length = Number(parameters.MaxBytes ?? parameters.MaxSizeLower)
                return { code: 0x2001, data: file.bytes.slice(offset, offset + length) }
            }
            case 'GetDevicePropDesc':
                if (parameters.DevicePropCode === 0x5011)
                    return { code: 0x2001, data: descriptor(registry, 0x5011, 0xffff, state.clock, state.clockWritable) }
                if (parameters.DevicePropCode === 0x5001)
                    return { code: 0x2001, data: descriptor(registry, 0x5001, 0x0002, 64, false) }
                return { code: 0x200a }
            case 'SetDevicePropValue':
                expect(parameters.DevicePropCode).toBe(0x5011)
                if (state.clockResponse !== 0x2001) return { code: state.clockResponse }
                if (state.clockApplies) state.clock = registry.codecs.string.decode(data!).value
                return { code: 0x2001 }
        }
        return { code: 0x2005 }
    }
    return { files, state, send }
}

/** A Sony live-view dataset: offset and size of the JPEG, no focal frames, then the JPEG at offset 24. */
function liveViewDataset(image: Uint8Array): Uint8Array {
    const header = new Uint8Array(24)
    const view = new DataView(header.buffer)
    view.setUint32(0, header.length, true)
    view.setUint32(4, image.length, true)
    return concatenate([header, image])
}

/** Simulated Sony body: SDIO inventory with card, battery and mode properties, content list, transfer. */
function sonyCamera() {
    const { transport, emit } = simulatedTransport()
    const camera = new Camera({ vendorId: 0x054c, transport })
    const driver = protocolSession(camera).driver as SonyCamera
    driver.sessionId = 7
    const codecs = driver.registry.codecs
    const body = {
        slotOneStatus: 1,
        slotTwoStatus: 2,
        photosRemaining: 412,
        transfer: false,
        operatingMode: 1,
        /** Native RecordingState (0xD21D), or undefined when the body leaves it out of its inventory. */
        recording: 0 as number | undefined,
        inventoryResponse: 0x2001,
        controls: [] as string[],
        dateTimeResult: 1 as number | undefined,
        dateTimeResponse: 0x2001,
        previewResponse: 0x2001,
        listResponse: 0x2001,
        transferModeChanges: [] as string[],
        downloads: [] as number[],
        dateTimeWrites: [] as string[],
    }
    const bigClip = 0x1_2345_6789
    const card: CardFile[] = [
        { handle: 0x21, storageId: 0x00010001, name: 'DSC00001.ARW', bytes: Uint8Array.of(1, 2, 3, 4), captureDate: '' },
        { handle: 0x22, storageId: 0x00010001, name: 'C0001.MP4', bytes: Uint8Array.of(5, 6), captureDate: '', reportedSize: 0xffffffff },
    ]
    const contents = [
        { contentId: 3, createdLocalMs: Date.UTC(2026, 10, 24, 9, 0, 0), files: [{ fileId: 1, path: 'DCIM/100MSDCF/DSC00001.ARW', size: 4 }] },
        { contentId: 4, createdLocalMs: Date.UTC(2026, 10, 24, 9, 5, 0), files: [
            { fileId: 1, path: 'PRIVATE/M4ROOT/CLIP/C0001.MP4', size: bigClip, video: true },
            { fileId: 2, path: 'PRIVATE/M4ROOT/CLIP/C0001M01.XML', size: 900 },
        ] },
    ]
    const property = (code: number, type: 2 | 6, value: number) => {
        const encode = (raw: number) => (type === 2 ? codecs.uint8.encode(raw) : codecs.uint32.encode(raw))
        return concatenate([
            codecs.uint16.encode(code),
            codecs.uint16.encode(type),
            codecs.uint8.encode(0),
            codecs.uint8.encode(1),
            encode(value),
            encode(value),
            codecs.uint8.encode(0),
        ])
    }
    const inventory = () => {
        const properties = [
            property(0xd248, 2, body.slotOneStatus),
            property(0xd249, 6, body.photosRemaining),
            property(0xd24a, 6, 0),
            property(0xd256, 2, body.slotTwoStatus),
            property(0xd218, 2, 79),
            property(0xd03a, 2, 2),
            property(0xd038, 6, 95),
            property(0xd295, 2, body.transfer ? 1 : 0),
            property(0xd0bc, 2, body.operatingMode),
            ...(body.recording === undefined ? [] : [property(0xd21d, 2, body.recording)]),
        ]
        const wire = concatenate([codecs.uint32.encode(properties.length), codecs.uint32.encode(0), ...properties])
        return new SDIDevicePropInfoArrayCodec(driver.registry).decode(wire).value
    }
    const send: Send = async (operation, parameters, data) => {
        switch (operation.name) {
            case 'SDIO_GetAllExtDevicePropInfo':
                if (body.inventoryResponse !== 0x2001) return { code: body.inventoryResponse }
                return { code: 0x2001, data: inventory() }
            case 'GetDeviceInfo':
                return {
                    code: 0x2001,
                    data: deviceInfo(driver.registry, { manufacturer: 'Sony Corporation', model: 'ILCE-7M5', firmware: '1.00' }, [], [0x1001]),
                }
            case 'SDIO_GetContentInfoList':
                if (body.listResponse !== 0x2001) return { code: body.listResponse }
                expect(parameters.Extra1).toBe(1)
                return { code: 0x2001, data: sonyContentList(1, contents) }
            case 'SDIO_GetContentCompressedData':
                if (body.previewResponse !== 0x2001) return { code: body.previewResponse }
                return { code: 0x2001, data: jpeg(Number(parameters.Type)) }
            case 'SDIO_SetContentsTransferMode':
                body.transferModeChanges.push(String(parameters.TransferMode))
                body.transfer = parameters.TransferMode === 'ENABLE'
                // Reading the card switches the body to Playback, and leaving transfer mode does not undo it.
                if (body.transfer) body.operatingMode = 2
                return { code: 0x2001 }
            case 'SDIO_ControlDevice':
                body.controls.push(`0x${Number(parameters.sdiControlCode).toString(16)}`)
                return { code: 0x2001 }
            case 'GetObject':
                expect(parameters.ObjectHandle).toBe(0xffffc002)
                // In Playback, the body refuses live view.
                return body.operatingMode === 2 ? { code: 0x200f } : { code: 0x2001, data: liveViewDataset(jpeg(0x77)) }
            case 'GetStorageIDs':
                return { code: 0x2001, data: [0x00010001] }
            case 'GetObjectHandles':
                expect(body.transfer).toBe(true)
                return { code: 0x2001, data: card.map(file => file.handle) }
            case 'GetObjectInfo': {
                const file = card.find(candidate => candidate.handle === parameters.ObjectHandle)
                return file ? { code: 0x2001, data: objectInfo(driver.registry, file) } : { code: 0x2009 }
            }
            case 'SDIO_GetPartialLargeObject': {
                const file = card.find(candidate => candidate.handle === parameters.ObjectHandle)!
                body.downloads.push(file.handle)
                const offset = Number(parameters.OffsetLower)
                return { code: 0x2001, data: file.bytes.slice(offset, offset + Number(parameters.MaxBytes)) }
            }
            case 'SDIO_SetExtDevicePropValue': {
                body.dateTimeWrites.push(codecs.string.decode(data!).value)
                const result = body.dateTimeResult
                if (body.dateTimeResponse === 0x2001 && result !== undefined)
                    emit({ code: 0xc205, parameters: [result], transactionId: 0 })
                return { code: body.dateTimeResponse }
            }
        }
        throw new Error(`Unexpected Sony operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    vi.spyOn(driver as unknown as { waitMs(milliseconds: number): Promise<void> }, 'waitMs').mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 0))
    )
    return { camera, driver, body, card, contents, bigClip, emit }
}

function canonCamera(options: { clock?: boolean; thumbnails?: boolean } = {}) {
    const { transport, emit } = simulatedTransport()
    const camera = new Camera({ vendorId: 0x04a9, transport, keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    driver.sessionId = 3
    const card = standardCard(driver.registry, { identity: { manufacturer: 'Canon Inc.', model: 'Canon EOS R8', firmware: '3-1.5.0' }, ...options })
    let events: Uint8Array[] = []
    const send: Send = async (operation, parameters, data) => {
        if (operation.name === 'CanonGetEventData') {
            const records = events
            events = []
            return { code: 0x2001, data: canonEvents(driver.registry, records) }
        }
        return card.send(operation, parameters, data)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    /** Queue EOS event records, as the camera sends them, for the next GetEvent. */
    const queueEvents = (records: Uint8Array[]) => {
        events = records
    }
    return { camera, driver, emit, queueEvents, ...card }
}

function nikonCamera() {
    const { transport, emit } = simulatedTransport()
    const camera = new Camera({ vendorId: 0x04b0, transport })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 5
    const card = standardCard(driver.registry, { identity: { manufacturer: 'Nikon Corporation', model: 'Z 5_2', firmware: '1.10' } })
    const queue: { code: number; parameters: number[] }[][] = []
    let polls = 0
    const send: Send = async (operation, parameters, data) => {
        if (operation.name === 'GetEventEx') {
            polls++
            const codec = new NikonEventDataCodec(driver.registry)
            return { code: 0x2001, data: codec.decode(codec.encode(queue.shift() ?? [])).value }
        }
        return card.send(operation, parameters, data)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, driver, emit, queue, polls: () => polls, ...card }
}

function genericCamera(options: { clock?: boolean; thumbnails?: boolean } = {}) {
    const { transport, emit } = simulatedTransport(TransportType.IP)
    const camera = new Camera({ transport })
    const driver = protocolSession(camera).driver
    driver.sessionId = 9
    const card = standardCard(driver.registry, { identity: { manufacturer: 'Example Optics', model: 'Model 1', firmware: '2.0' }, ...options })
    vi.spyOn(driver, 'send').mockImplementation(card.send as never)
    return { camera, driver, emit, ...card }
}

describe('media ids', () => {
    it('round-trip names with separators and refuse anything else', () => {
        const object = { source: 'object', storageId: 0x10001, objectHandle: 0x2a, name: 'A:B%C.JPG', sizeBytes: 12 } as const
        expect(decodeMediaId('listMedia', encodeMediaId(object))).toEqual(object)
        const content = { source: 'sony-content', slot: 2, contentId: 9, fileId: 1, name: 'C0001.MP4', sizeBytes: 0x1_0000_0000 } as const
        expect(decodeMediaId('listMedia', encodeMediaId(content))).toEqual(content)
        for (const id of ['', 'ptp:1:2', 'sony:3:1:1:1:x', 'ptp:zz:1::a', 'other:1:2:3:4'])
            expect(() => decodeMediaId('downloadMedia', id)).toThrow(CameraRefusedError)
    })
})

describe('card and media on a simulated generic PTP body', () => {
    it('reads card space from StorageInfo, leaving out the empty slot', async () => {
        const { camera } = genericCamera()
        expect(await camera.getCardStatus()).toEqual([
            { slot: 1, state: 'ready', writable: true, capacityBytes: 64_000_000_000, freeBytes: 32_000_000_000, photosRemaining: 1250 },
        ])
    })

    it('lists files newest first without folders, reads each object once per session, and finds them again by id', async () => {
        const { camera, driver } = genericCamera()
        const items = await camera.listMedia()
        expect(items.map(item => [item.name, item.kind, item.capturedAt])).toEqual([
            ['IMG_0002.CR3', 'photo', '2026-11-24T09:15:10'],
            ['MVI_0003.MP4', 'clip', '2026-11-24T09:15:05'],
            ['IMG_0001.JPG', 'photo', '2026-11-24T09:15:00'],
        ])
        expect(items[2]).toMatchObject({ slot: 1, sizeBytes: 5, widthPixels: 6000, heightPixels: 4000, previews: ['thumbnail'] })
        expect(items[0]!.previews).toEqual([])
        const infoReads = () => vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'GetObjectInfo').length
        const before = infoReads()
        await camera.listMedia()
        expect(infoReads()).toBe(before)
        expect(await camera.getMediaPreview(items[2]!.id, 'thumbnail')).toEqual(jpeg(0x51))
    })

    it('downloads with progress, and finds a file again after a new session renumbers it', async () => {
        const { camera, driver, files, state } = genericCamera()
        const [raw] = await camera.listMedia()
        const progress: number[] = []
        expect(await camera.downloadMedia(raw!.id, { onProgress: received => progress.push(received) })).toEqual(
            Uint8Array.of(1, 2, 3, 4, 5, 6, 7)
        )
        expect(progress.at(-1)).toBe(7)
        // A reconnect numbers the same file differently.
        driver.sessionId = 10
        files.find(file => file.name === 'IMG_0002.CR3')!.handle = 0x42
        expect(await camera.downloadMedia(raw!.id)).toEqual(Uint8Array.of(1, 2, 3, 4, 5, 6, 7))
        expect(state.downloads.at(-1)).toBe(0x42)
    })

    it('refuses an unknown or vanished file and a camera refusal; reports what the camera cannot do', async () => {
        const { camera, files, state } = genericCamera({ thumbnails: false })
        const [raw] = await camera.listMedia()
        await expect(camera.downloadMedia('not-an-id')).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.getMediaPreview(raw!.id, 'preview')).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.getMediaPreview(raw!.id, 'thumbnail')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect((await camera.getCapabilities()).operations?.getMediaPreview).toEqual({
            supported: false,
            reason: 'This camera does not offer thumbnails of its card files',
        })
        files.splice(files.findIndex(file => file.name === 'IMG_0002.CR3'), 1)
        await expect(camera.downloadMedia(raw!.id)).rejects.toThrow('IMG_0002.CR3 is no longer on the card')
        expect(state.downloads).toEqual([])
    })

    it('delivers settingsChanged and mediaAdded from the standard events until off()', async () => {
        const { camera, emit } = genericCamera()
        const settings = vi.fn()
        const media = vi.fn()
        camera.on('settingsChanged', settings)
        camera.on('mediaAdded', media)
        emit({ code: 0x4006, parameters: [0x5007], transactionId: 0 })
        emit({ code: 0x4002, parameters: [0x11], transactionId: 0 })
        emit({ code: 0x4004, parameters: [0x10001], transactionId: 0 })
        expect(settings).toHaveBeenCalledOnce()
        expect(media).toHaveBeenCalledOnce()
        camera.off('settingsChanged', settings)
        camera.off('mediaAdded', media)
        emit({ code: 0x4006, parameters: [0x5007], transactionId: 0 })
        emit({ code: 0x4002, parameters: [0x12], transactionId: 0 })
        expect(settings).toHaveBeenCalledOnce()
        expect(media).toHaveBeenCalledOnce()
    })
})

describe('clock on standard PTP bodies', () => {
    it.each([
        ['Canon', canonCamera],
        ['Nikon', nikonCamera],
        ['generic', genericCamera],
    ] as const)('sets DateTime once on a %s body and confirms it from the readback', async (_vendor, simulate) => {
        const { camera, driver, state } = simulate()
        const moment = new Date(2026, 10, 24, 14, 5, 9)
        await camera.setClock(moment)
        expect(state.clock).toBe('20261124T140509')
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'SetDevicePropValue')).toHaveLength(1)
    })

    it.each([
        ['Canon', canonCamera],
        ['Nikon', nikonCamera],
        ['generic', genericCamera],
    ] as const)('reports a %s refusal of the new time as refused, written once', async (_vendor, simulate) => {
        const { camera, driver, state } = simulate()
        state.clockResponse = 0x2019
        await expect(camera.setClock(new Date(2026, 10, 24, 14, 5, 9))).rejects.toBeInstanceOf(CameraRefusedError)
        expect(state.clock).toBe('20260101T000000')
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'SetDevicePropValue')).toHaveLength(1)
    })

    it('reports an unknown outcome, without writing again, when the readback does not show the new time', async () => {
        const { camera, driver, state } = genericCamera()
        state.clockApplies = false
        await expect(camera.setClock(new Date(2026, 10, 24, 14, 5, 9))).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'SetDevicePropValue')).toHaveLength(1)
    })

    it('is unsupported when DateTime is not advertised or is read-only, and sends nothing', async () => {
        const unadvertised = genericCamera({ clock: false })
        await expect(unadvertised.camera.setClock()).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect((await unadvertised.camera.getCapabilities()).operations?.setClock?.supported).toBe(false)
        const readOnly = genericCamera()
        readOnly.state.clockWritable = false
        await expect(readOnly.camera.setClock()).rejects.toThrow('read-only')
        for (const { driver } of [unadvertised, readOnly])
            expect(vi.mocked(driver.send).mock.calls.some(([operation]) => operation.name === 'SetDevicePropValue')).toBe(false)
    })

    it('refuses an invalid date before sending anything', async () => {
        const { camera, driver } = genericCamera()
        await expect(camera.setClock(new Date(Number.NaN))).rejects.toBeInstanceOf(CameraRefusedError)
        expect(driver.send).not.toHaveBeenCalled()
    })
})

describe('battery', () => {
    it('reads the standard BatteryLevel on a generic body', async () => {
        const { camera } = genericCamera()
        expect(await camera.getBattery()).toEqual({ percent: 64, powerSource: 'unknown' })
    })

    it('falls back to the Canon EOS level when BatteryLevel is not readable', async () => {
        const { camera, driver, send } = canonCamera()
        vi.mocked(driver.send).mockImplementation((async (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) =>
            operation.name === 'GetDevicePropDesc' && parameters.DevicePropCode === 0x5001
                ? { code: 0x2005 }
                : operation.name === 'CanonGetEventData'
                  ? {
                        code: 0x2001,
                        data: new CanonEventDataCodec(driver.registry).decode(
                            Uint8Array.of(16, 0, 0, 0, 0x89, 0xc1, 0, 0, 0x11, 0xd1, 0, 0, 2, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0)
                        ).value,
                    }
                  : send(operation, parameters, data)) as never)
        await driver.refreshEventProperties()
        expect(await camera.getBattery()).toEqual({ level: 'full', powerSource: 'unknown' })
    })

    it('is unsupported when the camera reports nothing', async () => {
        const { camera, driver, send } = genericCamera()
        vi.mocked(driver.send).mockImplementation((async (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) =>
            operation.name === 'GetDevicePropDesc' ? { code: 0x200a } : send(operation, parameters, data)) as never)
        await expect(camera.getBattery()).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})

describe('a simulated Sony body', () => {
    it('reads each slot from its property snapshot, never PTP storage capacity', async () => {
        const { camera, driver } = sonyCamera()
        expect(await camera.getCardStatus()).toEqual([
            { slot: 1, state: 'ready', photosRemaining: 412 },
            { slot: 2, state: 'absent' },
        ])
        expect(vi.mocked(driver.send).mock.calls.some(([operation]) => operation.name === 'GetStorageInfo')).toBe(false)
    })

    it('lists its card index newest first without entering content-transfer mode', async () => {
        const { camera, body, bigClip } = sonyCamera()
        const items = await camera.listMedia()
        expect(items.map(item => [item.name, item.kind, item.capturedAt, item.sizeBytes])).toEqual([
            ['C0001.MP4', 'clip', '2026-11-24T09:05:00', bigClip],
            ['C0001M01.XML', 'other', '2026-11-24T09:05:00', 900],
            ['DSC00001.ARW', 'photo', '2026-11-24T09:00:00', 4],
        ])
        expect(items[0]).toMatchObject({ widthPixels: 3840, heightPixels: 2160, previews: ['thumbnail', 'preview'] })
        expect(items[1]!.previews).toEqual([])
        expect(body.transferModeChanges).toEqual([])
        expect(await camera.getMediaPreview(items[2]!.id, 'thumbnail')).toEqual(jpeg(1))
        expect(await camera.getMediaPreview(items[2]!.id, 'preview')).toEqual(jpeg(2))
        await expect(camera.getMediaPreview(items[1]!.id)).rejects.toBeInstanceOf(CameraUnsupportedError)
        body.previewResponse = 0x2009
        await expect(camera.getMediaPreview(items[2]!.id)).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('reports a body without a card index as unsupported and a refusal as refused', async () => {
        const unsupported = sonyCamera()
        unsupported.body.listResponse = 0x2005
        await expect(unsupported.camera.listMedia()).rejects.toBeInstanceOf(CameraUnsupportedError)
        const refused = sonyCamera()
        refused.body.listResponse = 0x2019
        await expect(refused.camera.listMedia()).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('downloads by name in content-transfer mode, using the card index size past 4 GiB', async () => {
        const { camera, driver, body } = sonyCamera()
        const items = await camera.listMedia()
        const photo = items.find(item => item.name === 'DSC00001.ARW')!
        expect(await camera.downloadMedia(photo.id)).toEqual(Uint8Array.of(1, 2, 3, 4))
        expect(body.transferModeChanges).toEqual(['ENABLE'])
        const clip = items.find(item => item.name === 'C0001.MP4')!
        const getObject = vi.spyOn(driver, 'getObject').mockResolvedValue(Uint8Array.of(5, 6))
        await camera.downloadMedia(clip.id)
        expect(getObject).toHaveBeenCalledWith(0x22, 0x1_2345_6789, undefined, undefined)
    })

    it('reopens once on the live-view frame after a download that left the body in playback', async () => {
        const { camera, driver, body } = sonyCamera()
        const reopen = vi.spyOn(driver, 'reopenSession').mockImplementation(async () => {
            body.operatingMode = 1
        })
        const photo = (await camera.listMedia()).find(item => item.name === 'DSC00001.ARW')!
        await camera.downloadMedia(photo.id)
        expect(body.operatingMode).toBe(2)
        expect((await protocolSession(camera).driver.captureLiveView({ includeInfo: false })).data).toEqual(jpeg(0x77))
        expect(reopen).toHaveBeenCalledOnce()
        await protocolSession(camera).driver.captureLiveView({ includeInfo: false })
        expect(reopen).toHaveBeenCalledOnce()
    })

    it.each([
        ['missing', undefined],
        ['recording', 1],
        ['recording failed', 2],
        ['waiting for interval recording', 3],
    ] as const)('keeps the session when the native recording state is %s', async (_state, recording) => {
        const { camera, driver, body } = sonyCamera()
        const reopen = vi.spyOn(driver, 'reopenSession').mockResolvedValue(undefined)
        const photo = (await camera.listMedia()).find(item => item.name === 'DSC00001.ARW')!
        await camera.downloadMedia(photo.id)
        body.recording = recording
        await expect(protocolSession(camera).driver.captureLiveView({ includeInfo: false })).rejects.toMatchObject({ code: 0x200f })
        expect(reopen).not.toHaveBeenCalled()
    })

    it('never reopens while a caller holds an object-handle baseline from this session', async () => {
        const { camera, driver, body } = sonyCamera()
        const reopen = vi.spyOn(driver, 'reopenSession').mockResolvedValue(undefined)
        const photo = (await camera.listMedia()).find(item => item.name === 'DSC00001.ARW')!
        await camera.downloadMedia(photo.id)
        // A recording or capture workflow reads the handles it compares against later.
        expect(await readCameraObjectHandles(camera)).toEqual(new Set([0x21, 0x22]))
        expect(body.operatingMode).toBe(2)
        await expect(protocolSession(camera).driver.captureLiveView({ includeInfo: false })).rejects.toMatchObject({ code: 0x200f })
        expect(reopen).not.toHaveBeenCalled()
    })

    it('handles a live-view refusal itself: one return to shooting, with no capture or record command', async () => {
        const { camera, driver, body } = sonyCamera()
        const reopen = vi.spyOn(driver, 'reopenSession').mockImplementation(async () => {
            body.operatingMode = 1
        })
        // Left in Playback by something other than Slate's own media reads.
        body.operatingMode = 2
        expect((await protocolSession(camera).driver.captureLiveView({ includeInfo: false })).data).toEqual(jpeg(0x77))
        expect(reopen).toHaveBeenCalledOnce()
        const { ShutterReleaseButton, ShutterHalfReleaseButton, MovieRecButton } = driver.registry.properties
        for (const control of [ShutterReleaseButton, ShutterHalfReleaseButton, MovieRecButton])
            expect(body.controls).not.toContain(`0x${control.code.toString(16)}`)
    })

    it('re-arms shooting on the next live-view frame after a recording stops, without reopening', async () => {
        const { camera, driver, body } = sonyCamera()
        const reopen = vi.spyOn(driver, 'reopenSession').mockResolvedValue(undefined)
        await driver.sendStopRecording()
        expect((await protocolSession(camera).driver.captureLiveView({ includeInfo: false })).data).toEqual(jpeg(0x77))
        expect(body.transferModeChanges).toEqual(['DISABLE'])
        expect(reopen).not.toHaveBeenCalled()
    })

    it('reuses a fresh property snapshot for the card status, and refuses when the camera refuses its inventory', async () => {
        const { camera, driver } = sonyCamera()
        const inventoryReads = () =>
            vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'SDIO_GetAllExtDevicePropInfo').length
        await protocolSession(camera).getSonyPropertyStates()
        const before = inventoryReads()
        expect(await camera.getCardStatus()).toHaveLength(2)
        expect(inventoryReads()).toBe(before)
        const refused = sonyCamera()
        refused.body.inventoryResponse = 0x2019
        await expect(refused.camera.getCardStatus()).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('checks a preview id against the card index in a new session, finding the file by name or refusing', async () => {
        const { camera, driver, contents } = sonyCamera()
        const photo = (await camera.listMedia()).find(item => item.name === 'DSC00001.ARW')!
        const previewRequests = () =>
            vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'SDIO_GetContentCompressedData')
        // A new session, after the body deleted a file and renumbered its index.
        driver.sessionId = 8
        contents[0]!.files[0] = { fileId: 1, path: 'DCIM/100MSDCF/DSC00002.ARW', size: 6 }
        contents.push({ contentId: 5, createdLocalMs: Date.UTC(2026, 10, 24, 9, 0, 0), files: [{ fileId: 1, path: 'DCIM/100MSDCF/DSC00001.ARW', size: 4 }] })
        expect(await camera.getMediaPreview(photo.id, 'thumbnail')).toEqual(jpeg(1))
        expect(previewRequests().at(-1)?.[1]).toMatchObject({ ContentID: 5 })
        contents.pop()
        driver.sessionId = 9
        const sent = previewRequests().length
        await expect(camera.getMediaPreview(photo.id)).rejects.toThrow('DSC00001.ARW is no longer on the card')
        expect(previewRequests()).toHaveLength(sent)
    })

    it('reads the battery from the same snapshot', async () => {
        const { camera } = sonyCamera()
        expect(await camera.getBattery()).toEqual({ percent: 79, minutesRemaining: 95, powerSource: 'battery' })
    })

    it('sets the clock once and waits for the camera to confirm it', async () => {
        const { camera, body } = sonyCamera()
        const moment = new Date(2026, 10, 24, 14, 5, 9, 456)
        await camera.setClock(moment)
        // Local wall time, tenths of a second and the UTC offset, as Sony expects.
        const offsetMinutes = -moment.getTimezoneOffset()
        const offset = `${offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')}${String(Math.abs(offsetMinutes) % 60).padStart(2, '0')}`
        expect(body.dateTimeWrites).toEqual([`20261124T140509.4${offset}`])
    })

    it('reports a refused clock and an unconfirmed one, each written once', async () => {
        const refused = sonyCamera()
        refused.body.dateTimeResult = 3
        await expect(refused.camera.setClock()).rejects.toBeInstanceOf(CameraRefusedError)
        const rejected = sonyCamera()
        rejected.body.dateTimeResponse = 0x2019
        await expect(rejected.camera.setClock()).rejects.toBeInstanceOf(CameraRefusedError)
        const unconfirmed = sonyCamera()
        unconfirmed.body.dateTimeResult = undefined
        let now = Date.now()
        vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000))
        await expect(unconfirmed.camera.setClock()).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
        for (const { body } of [refused, rejected, unconfirmed]) expect(body.dateTimeWrites).toHaveLength(1)
    })

    it('delivers settingsChanged and mediaAdded from its own event codes until off()', async () => {
        const { camera, emit } = sonyCamera()
        const settings = vi.fn()
        const media = vi.fn()
        camera.on('settingsChanged', settings)
        camera.on('mediaAdded', media)
        emit({ code: 0xc203, parameters: [0], transactionId: 0 })
        emit({ code: 0xc201, parameters: [0x21], transactionId: 0 })
        emit({ code: 0x4002, parameters: [0x22], transactionId: 0 })
        // A card save announces itself through the card index (slot 1, event type 1).
        emit({ code: 0xc234, parameters: [1, 1], transactionId: 0 })
        emit({ code: 0xc234, parameters: [1, 2], transactionId: 0 })
        expect(settings).toHaveBeenCalledOnce()
        expect(media).toHaveBeenCalledTimes(3)
        camera.off('mediaAdded', media)
        emit({ code: 0xc201, parameters: [0x23], transactionId: 0 })
        emit({ code: 0xc234, parameters: [1, 1], transactionId: 0 })
        expect(media).toHaveBeenCalledTimes(3)
    })
})

describe('Canon events', () => {
    it('maps EOS property and new-object records to the public events', async () => {
        const { camera, driver, queueEvents } = canonCamera()
        const settings = vi.fn()
        const media = vi.fn()
        camera.on('settingsChanged', settings)
        camera.on('mediaAdded', media)
        // The first record of a setting after connect is its baseline, not a change.
        queueEvents([canonValue(0xd101, 4)])
        await driver.refreshEventProperties()
        queueEvents([canonValue(0xd101, 5), canonObjectAdded(0x11, 'IMG_0001.JPG', 1024)])
        await driver.refreshEventProperties()
        expect(settings).toHaveBeenCalledOnce()
        expect(media).toHaveBeenCalledOnce()
        camera.off('settingsChanged')
        queueEvents([canonValue(0xd101, 6)])
        await driver.refreshEventProperties()
        expect(settings).toHaveBeenCalledOnce()
    })
})

describe('getInfo', () => {
    it.each([
        ['generic PTP', genericCamera, { manufacturer: 'Example Optics', model: 'Model 1', firmware: '2.0', serialNumber: '0001', connection: 'ip' }],
        ['Sony', sonyCamera, { manufacturer: 'Sony', model: 'ILCE-7M5', firmware: '1.00', serialNumber: '0001', lensMount: 'E', connection: 'usb' }],
        ['Canon EOS R', canonCamera, { manufacturer: 'Canon', model: 'Canon EOS R8', firmware: '3-1.5.0', serialNumber: '0001', lensMount: 'RF', connection: 'usb' }],
        ['Nikon Z', nikonCamera, { manufacturer: 'Nikon', model: 'Z 5_2', firmware: '1.10', serialNumber: '0001', lensMount: 'Z', connection: 'usb' }],
    ] as const)('reports make, model, firmware, connection and only a known lens mount on %s', async (_body, simulate, info) => {
        expect(await simulate().camera.getInfo()).toEqual(info)
    })
})

describe.each([
    ['generic PTP', genericCamera],
    ['Canon', canonCamera],
    ['Nikon', nikonCamera],
] as const)('%s thumbnails and downloads', (_vendor, simulate) => {
    it('returns the thumbnail and the file, each requested once', async () => {
        const { camera, driver, state } = simulate()
        const items = await camera.listMedia()
        const jpegItem = items.find(item => item.name === 'IMG_0001.JPG')!
        expect(await camera.getMediaPreview(jpegItem.id, 'thumbnail')).toEqual(jpeg(0x51))
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'GetThumb')).toHaveLength(1)
        expect(await camera.downloadMedia(jpegItem.id)).toEqual(jpeg(1))
        expect(state.downloads).toEqual([0x11])
    })

    it('reports a refused thumbnail and a refused download as refused, without asking again', async () => {
        const { camera, driver, state } = simulate()
        const jpegItem = (await camera.listMedia()).find(item => item.name === 'IMG_0001.JPG')!
        state.refuseThumbnails = true
        await expect(camera.getMediaPreview(jpegItem.id)).rejects.toBeInstanceOf(CameraRefusedError)
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'GetThumb')).toHaveLength(1)
        state.refuseDownloads = true
        const downloadRequests = () =>
            vi.mocked(driver.send).mock.calls.filter(([operation]) => /^GetPartialObject/.test(operation.name)).length
        await expect(camera.downloadMedia(jpegItem.id)).rejects.toBeInstanceOf(CameraRefusedError)
        expect(downloadRequests()).toBe(1)
        expect(state.downloads).toEqual([])
    })
})

describe('Nikon originals over 4 GiB', () => {
    const bigFile = (files: CardFile[]) => {
        const file: CardFile = {
            handle: 0x14,
            storageId: 0x00010001,
            name: 'DSC_0004.MOV',
            bytes: Uint8Array.of(7, 7),
            captureDate: '20261124T091520',
            reportedSize: 0xffffffff,
        }
        files.push(file)
        return file
    }

    it('downloads with the size from Nikon GetObjectSize, a UINT64 for the exact handle', async () => {
        const { camera, driver, files, send } = nikonCamera()
        bigFile(files)
        const fullSize = 0x1_2345_6789n
        vi.mocked(driver.send).mockImplementation((async (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) => {
            if (operation.name !== 'GetObjectSize') return send(operation, parameters, data)
            expect(parameters.ObjectHandle).toBe(0x14)
            const codec = driver.registry.codecs.uint64
            return { code: 0x2001, data: codec.decode(codec.encode(fullSize)).value }
        }) as never)
        const clip = (await camera.listMedia()).find(item => item.name === 'DSC_0004.MOV')!
        const getObject = vi.spyOn(driver, 'getObject').mockResolvedValue(Uint8Array.of(7, 7))
        await camera.downloadMedia(clip.id)
        expect(getObject).toHaveBeenCalledWith(0x14, Number(fullSize), undefined, undefined)
    })

    it('refuses the download when the camera does not confirm the full size, and transfers nothing', async () => {
        const { camera, driver, files, send, state } = nikonCamera()
        bigFile(files)
        vi.mocked(driver.send).mockImplementation((async (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) =>
            operation.name === 'GetObjectSize' ? { code: 0x2019 } : send(operation, parameters, data)) as never)
        const clip = (await camera.listMedia()).find(item => item.name === 'DSC_0004.MOV')!
        const refusal = camera.downloadMedia(clip.id)
        await expect(refusal).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(refusal).rejects.toThrow('did not confirm the full 64-bit original size')
        expect(state.downloads).toEqual([])
        expect(vi.mocked(driver.send).mock.calls.filter(([operation]) => operation.name === 'GetObjectSize')).toHaveLength(1)
    })
})

describe('Nikon event pump', () => {
    it('polls only while a listener exists and delivers the queued events', async () => {
        vi.useFakeTimers()
        const { camera, queue, polls } = nikonCamera()
        await vi.advanceTimersByTimeAsync(2_000)
        expect(polls()).toBe(0)
        const media = vi.fn()
        const settings = vi.fn()
        camera.on('mediaAdded', media)
        camera.on('settingsChanged', settings)
        queue.push([{ code: 0x4002, parameters: [0x11] }, { code: 0x4006, parameters: [0x5007] }])
        await vi.advanceTimersByTimeAsync(600)
        expect(media).toHaveBeenCalledOnce()
        expect(settings).toHaveBeenCalledOnce()
        camera.off('mediaAdded', media)
        camera.off('settingsChanged', settings)
        const stopped = polls()
        await vi.advanceTimersByTimeAsync(2_000)
        expect(polls()).toBe(stopped)
    })

    it('keeps a memory capture\'s object when another poll drains the queue first', async () => {
        const { driver } = nikonCamera()
        const codec = new NikonEventDataCodec(driver.registry)
        const events = (queued: { code: number; parameters: number[] }[]) => codec.decode(codec.encode(queued)).value
        const memoryObject: CardFile = { handle: 0xffff0001, storageId: 0, name: 'MEM.JPG', bytes: jpeg(7), captureDate: '' }
        vi.spyOn(driver, 'get').mockImplementation((async (property: { name: string }) =>
            property.name === 'LiveViewSelector' ? 'PHOTO' : 'OFF') as never)
        let pending: { code: number; parameters: number[] }[] = []
        let drainedByAnotherPoll = false
        vi.mocked(driver.send).mockImplementation((async (operation: OperationDefinition, parameters: Record<string, unknown>) => {
            switch (operation.name) {
                case 'GetDeviceInfo':
                    return { code: 0x2001, data: deviceInfo(driver.registry, { manufacturer: 'Nikon', model: 'Z 5_2', firmware: '1' }, [], [0x9207]) }
                case 'InitiateCaptureRecInMedia':
                    pending = [{ code: 0xc101, parameters: [memoryObject.handle] }]
                    // A listener's pump reads the queue before the capture's own poll does.
                    await driver.pollEvents()
                    drainedByAnotherPoll = true
                    return { code: 0x2001 }
                case 'GetEventEx': {
                    const queued = pending
                    pending = []
                    return { code: 0x2001, data: events(queued) }
                }
                case 'GetObjectInfo':
                    expect(parameters.ObjectHandle).toBe(memoryObject.handle)
                    return { code: 0x2001, data: objectInfo(driver.registry, memoryObject) }
                case 'GetPartialObjectEx':
                    return { code: 0x2001, data: memoryObject.bytes }
            }
            return { code: 0x2001 }
        }) as never)
        const result = await driver.captureImage({ destination: 'memory', autofocus: false })
        expect(drainedByAnotherPoll).toBe(true)
        expect(result.data).toEqual(jpeg(7))
    })
})

describe('named events across a reconnect', () => {
    it('ends named listeners when the session closes', async () => {
        const { camera, driver, emit } = sonyCamera()
        const media = vi.fn()
        camera.on('mediaAdded', media)
        vi.spyOn(driver, 'disconnect').mockImplementation(async () => {
            driver.sessionId = null
        })
        await camera.disconnect()
        emit({ code: 0xc201, parameters: [1], transactionId: 0 })
        expect(media).not.toHaveBeenCalled()
    })
})

describe('a Sony Wi-Fi SDK session', () => {
    it('reads battery and card slots from the SDK properties', async () => {
        const properties = [
            { code: 1794, type: 3, value: 55, writable: false },
            { code: 1847, type: 3, value: 120, writable: false },
            { code: 1800, type: 3, value: 0, writable: false },
            { code: 1801, type: 3, value: 300, writable: false },
            { code: 1802, type: 3, value: 0, writable: false },
            { code: 1805, type: 3, value: 1, writable: false },
        ]
        const camera = new SonyWifiCamera({ request: async () => ({ properties }), close: async () => {} })
        Object.assign(camera, { connected: true })
        expect(await camera.getBattery()).toEqual({ percent: 55, minutesRemaining: 120, powerSource: 'unknown' })
        expect(await camera.getCardStatus()).toEqual([
            { slot: 1, state: 'ready', photosRemaining: 300 },
            { slot: 2, state: 'absent' },
        ])
    })
})
