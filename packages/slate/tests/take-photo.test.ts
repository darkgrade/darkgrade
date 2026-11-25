/**
 * takePhoto end to end on simulated Sony, Canon, Nikon and standard PTP bodies. Object
 * information and device information are encoded and decoded with the real codecs, Sony's card
 * index uses the ContentInfoList layout its parser reads, and events arrive with their wire codes.
 * Each vendor covers a confirmed photo (card and computer) whose media id downloads the same file,
 * a refused release, an unsupported request and a release the camera never confirms, which is
 * never repeated.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { canonEvents, canonObjectAdded } from '@tests/fixtures/canon-events'
import { sonyContentList } from '@tests/fixtures/sony-content-list'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { decodeMediaId, encodeMediaId, type MediaReference } from '@vendors/generic/media-id'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined, getType: () => 'usb' }) as unknown as TransportInterface

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
const CARD_STORAGE = 0x00010001

/** An ObjectInfo reply exactly as the codec decodes it from the wire. */
function objectInfo(camera: Camera, filename: string, size = jpeg.length, associationType = 0): ObjectInfo {
    const codec = new ObjectInfoCodec(protocolSession(camera).driver.registry)
    return codec.decode(
        codec.encode({
            storageID: CARD_STORAGE,
            objectFormat: associationType ? 0x3001 : 0x3801,
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
            associationType,
            associationDesc: 0,
            sequenceNumber: 0,
            filename,
            captureDate: '20261124T120000',
            modificationDate: '20261124T120000',
            keywords: '',
        })
    ).value
}

/** A DeviceInfo reply exactly as the codec decodes it: GetObjectInfo, GetObject and GetThumb. */
function deviceInfo(camera: Camera, eventsSupportedRaw: number[] = []): DeviceInfo {
    const codec = new DeviceInfoCodec(protocolSession(camera).driver.registry)
    return codec.decode(
        codec.encode({
            standardVersion: 100,
            vendorExtensionID: 0,
            vendorExtensionVersion: 100,
            vendorExtensionDesc: '',
            functionalMode: 0,
            operationsSupportedRaw: [0x1008, 0x1009, 0x100a],
            operationsSupportedDecoded: [],
            eventsSupportedRaw,
            eventsSupportedDecoded: [],
            devicePropertiesSupported: [],
            devicePropertiesSupportedDecoded: [],
            captureFormats: [],
            imageFormatsRaw: [],
            imageFormatsDecoded: [],
            manufacturer: 'Simulated',
            model: 'Simulated',
            deviceVersion: '1.00',
            serialNumber: '0001',
        })
    ).value
}

/** Delivers an event the way the transport does (the driver's event handler is internal). */
function emit(driver: object, event: { code: number; parameters: number[] }) {
    const handleEvent: (event: { code: number; parameters: number[]; transactionId: number }) => void =
        Reflect.get(driver, 'handleEvent')
    handleEvent.call(driver, { ...event, transactionId: 0 })
}

type Send = (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) => Promise<unknown>

/** What a simulated body's photo should come back as, and the card bytes its media id downloads. */
interface Expected {
    reference: MediaReference
    sizeBytes: number
    card: Uint8Array
    computer: Uint8Array
}

const objectReference = (objectHandle: number, name: string): MediaReference => ({
    source: 'object',
    storageId: CARD_STORAGE,
    objectHandle,
    name,
    sizeBytes: jpeg.length,
})

/**
 * Sony: two-stage release through the driver's button properties; the body adds 0xFFFFC001 for
 * the host, a smaller PC copy than the card file, which its card index lists as content 7. An
 * older file of the same name (the camera's numbering wrapped) is content 2.
 */
function sonyBody() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    driver.sessionId = 1
    const hostCopy = jpeg
    const cardFile = Uint8Array.of(0xff, 0xd8, 1, 2, 3, 0xff, 0xd9)
    const olderFile = Uint8Array.of(0xff, 0xd8, 9, 0xff, 0xd9)
    const body = {
        delivers: true,
        focuses: true,
        presses: 0,
        transfer: false,
        cardIndex: 'lists' as 'lists' | 'unsupported' | 'never',
        movieMode: false,
        restoresMovieMode: true,
    }
    const resumeShooting = vi.spyOn(driver, 'resumeShooting').mockResolvedValue()
    // The save destination reads as writable again once the body has finished with the shot.
    const propertyCache: Map<number, unknown> = Reflect.get(driver, 'propertyCache')
    vi.spyOn(driver, 'refreshPropertyStates').mockImplementation(async () => {
        propertyCache.set(driver.registry.properties.StillImageSaveDestination.code, { vendorExtensions: { enabled: true } })
        if (!body.movieMode) return []
        return [{ code: 0x500e, value: 'Movie Manual', rawValue: 0x8050, allowedValues: ['Manual', 'Movie Manual'] }] as never
    })
    // Live view is the driver's own business here; the release sequence is under test.
    Object.assign(driver, { startLiveView: async () => undefined, stopLiveView: async () => undefined })
    vi.spyOn(driver, 'get').mockImplementation(async property => {
        if (property.name === 'FocusIndication') return (body.focuses ? 'AF_S_FOCUSED' : 'AF_S_NOT_FOCUSED') as never
        if (property.name === 'ContentTransferEnable') return (body.transfer ? 'ENABLE' : 'DISABLE') as never
        return 'CAMERA_DEVICE' as never
    })
    vi.spyOn(driver, 'set').mockImplementation(async (property, value) => {
        if (property.name === 'ExposureProgramMode' && value === 'Movie Manual' && !body.restoresMovieMode)
            throw new Error('Sony answered 0x2019 restoring Movie Manual')
        if (property.name !== 'ShutterReleaseButton' || value !== 'DOWN') return
        body.presses++
        if (body.delivers) emit(driver, { code: 0xc201, parameters: [0xffffc001] })
        // The card index announces the saved file (SDIE_ContentInfoListChanged, slot 1, type 1).
        if (body.delivers && body.cardIndex === 'lists') emit(driver, { code: 0xc234, parameters: [1, 1] })
    })
    const card = new Map([
        [0x30, olderFile],
        [0x31, cardFile],
    ])
    const send: Send = async (operation, parameters) => {
        switch (operation.name) {
            case 'GetDeviceInfo':
                return { code: 0x2001, data: deviceInfo(camera, body.cardIndex === 'unsupported' ? [] : [0xc234]) }
            case 'SDIO_GetContentInfoList': {
                if (body.cardIndex === 'unsupported') return { code: 0x2005 }
                const older = { contentId: 2, createdLocalMs: Date.UTC(2026, 0, 1), files: [{ fileId: 1, path: 'DCIM/100MSDCF/DSC00001.JPG', size: olderFile.length }] }
                const taken = {
                    contentId: 7,
                    createdLocalMs: Date.UTC(2026, 10, 24, 12),
                    files: [
                        { fileId: 1, path: 'DCIM/101MSDCF/DSC00001.ARW', size: 24 },
                        { fileId: 2, path: 'DCIM/101MSDCF/DSC00001.JPG', size: cardFile.length },
                    ],
                }
                const listed = body.presses > 0 && body.cardIndex === 'lists' ? [taken, older] : [older]
                return { code: 0x2001, data: sonyContentList(1, listed) }
            }
            case 'SDIO_SetContentsTransferMode':
                body.transfer = parameters.TransferMode === 'ENABLE'
                return { code: 0x2001 }
            case 'GetStorageIDs':
                return { code: 0x2001, data: [CARD_STORAGE] }
            case 'GetObjectHandles':
                return { code: 0x2001, data: [...card.keys()] }
            case 'GetObjectInfo': {
                if (parameters.ObjectHandle === 0xffffc001) return { code: 0x2001, data: objectInfo(camera, 'DSC00001.JPG', hostCopy.length) }
                const file = card.get(Number(parameters.ObjectHandle))
                return file ? { code: 0x2001, data: objectInfo(camera, 'DSC00001.JPG', file.length) } : { code: 0x2009 }
            }
            case 'GetObject':
                return { code: 0x2001, data: hostCopy }
            case 'SDIO_GetPartialLargeObject': {
                const file = card.get(Number(parameters.ObjectHandle))
                if (!file) return { code: 0x2009 }
                const offset = Number(parameters.OffsetLower)
                return { code: 0x2001, data: file.slice(offset, offset + Number(parameters.MaxBytes)) }
            }
        }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const expected: Expected = {
        reference: { source: 'sony-content', slot: 1, contentId: 7, fileId: 2, name: 'DSC00001.JPG', sizeBytes: cardFile.length },
        sizeBytes: cardFile.length,
        card: cardFile,
        computer: hostCopy,
    }
    return {
        camera,
        body,
        resumeShooting,
        expected,
        presses: () => body.presses,
        refuse: () => (body.focuses = false),
        lose: () => (body.delivers = false),
    }
}

/** Canon: RemoteReleaseOn presses, confirmed by the ObjectAddedEx record GetEvent returns. */
function canonBody() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    driver.sessionId = 1
    const body = { queued: [] as Uint8Array[], refuses: false, writes: true, presses: 0, focusPresses: [] as string[] }
    vi.spyOn(driver, 'listUnknownPropertyStates').mockReturnValue([])
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    const send: Send = async (operation, parameters) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera) }
        if (operation.name === 'GetStorageIDs') return { code: 0x2001, data: [CARD_STORAGE] }
        if (operation.name === 'CanonGetEventData')
            return { code: 0x2001, data: canonEvents(driver.registry, body.queued.splice(0)) }
        if (operation.name === 'CanonRemoteReleaseOn' && parameters.ReleaseMode === 'SHUTTER') {
            body.presses++
            body.focusPresses.push(String(parameters.AFMode))
            // DeviceBusy at an AF full press: the body could not lock focus.
            if (body.refuses) return { code: 0x2019 }
            if (body.writes) body.queued.push(canonObjectAdded(2, 'IMG_0002.JPG', jpeg.length, CARD_STORAGE))
        }
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: objectInfo(camera, 'IMG_0002.JPG') }
        return { code: 0x2001, parameters: [] }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const expected: Expected = { reference: objectReference(2, 'IMG_0002.JPG'), sizeBytes: jpeg.length, card: jpeg, computer: jpeg }
    return {
        camera,
        body,
        expected,
        presses: () => body.presses,
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = false),
    }
}

/** Nikon: InitiateCapture, then ObjectAdded queued for GetEventEx once the file is on the card. */
function nikonBody() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const body = {
        queued: [] as { code: number; parameters: number[] }[],
        // Files each release writes, announced one event poll after another.
        writes: [[0x00010100, 0x00010101]] as number[][],
        refuses: false,
        presses: 0,
    }
    const names = new Map([
        [0x00010101, 'DSC_0001.JPG'],
        [0x00010102, 'DSC_0001.NEF'],
    ])
    vi.spyOn(driver, 'get').mockImplementation(async property =>
        (property.name === 'LiveViewSelector' ? 'PHOTO' : property.name === 'LiveViewStatus' ? 'ON' : 'OFF') as never
    )
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    let pending: number[][] = []
    const send: Send = async (operation, parameters) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera) }
        if (operation.name === 'InitiateCapture') {
            body.presses++
            if (body.refuses) return { code: 0x2019 }
            pending = body.writes.map(poll => [...poll])
        }
        if (operation.name === 'GetEventEx') {
            // A new folder may be announced too; it is never taken for the photo.
            const announced = (pending.shift() ?? []).map(handle => ({ code: 0x4002, parameters: [handle] }))
            return { code: 0x2001, data: [...body.queued.splice(0), ...announced] }
        }
        if (operation.name === 'GetObjectInfo') {
            const handle = Number(parameters.ObjectHandle)
            if (handle === 0x00010100) return { code: 0x2001, data: objectInfo(camera, '100NCZ_5', 0, 1) }
            const name = names.get(handle)
            return name ? { code: 0x2001, data: objectInfo(camera, name) } : { code: 0x2009 }
        }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const expected: Expected = { reference: objectReference(0x00010101, 'DSC_0001.JPG'), sizeBytes: jpeg.length, card: jpeg, computer: jpeg }
    return {
        camera,
        body,
        expected,
        presses: () => body.presses,
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = []),
    }
}

/** Standard PTP: InitiateCapture, confirmed by an ObjectAdded event on the interrupt pipe. */
function standardBody() {
    const camera = new Camera({ transport: transport() })
    const driver = protocolSession(camera).driver
    driver.sessionId = 1
    const body = { refuses: false, writes: true, presses: 0 }
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    const send: Send = async operation => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera) }
        if (operation.name === 'InitiateCapture') {
            body.presses++
            if (body.refuses) return { code: 0x2019 }
            if (body.writes) setTimeout(() => emit(driver, { code: 0x4002, parameters: [7] }), 0)
        }
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: objectInfo(camera, 'P0000001.JPG') }
        if (operation.name === 'GetObject') return { code: 0x2001, data: jpeg }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const expected: Expected = { reference: objectReference(7, 'P0000001.JPG'), sizeBytes: jpeg.length, card: jpeg, computer: jpeg }
    return {
        camera,
        body,
        expected,
        presses: () => body.presses,
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = false),
    }
}

const vendors = [
    ['Sony', sonyBody, 'DSC00001.JPG'],
    ['Canon', canonBody, 'IMG_0002.JPG'],
    ['Nikon', nikonBody, 'DSC_0001.JPG'],
    ['standard PTP', standardBody, 'P0000001.JPG'],
] as const

describe.each(vendors)('takePhoto on a simulated %s body', (_vendor, simulate, name) => {
    it('resolves to the new card file, named with the id listMedia gives it, once', async () => {
        const { camera, presses, expected } = simulate()
        const photo = await camera.takePhoto()
        expect(photo).toEqual({ destination: 'card', mediaId: encodeMediaId(expected.reference), name, sizeBytes: expected.sizeBytes })
        expect(decodeMediaId('downloadMedia', photo.mediaId!)).toEqual(expected.reference)
        expect(presses()).toBe(1)
    })

    it('returns a media id that downloadMedia reads the card file with', async () => {
        const { camera, presses, expected } = simulate()
        const photo = await camera.takePhoto()
        await expect(camera.downloadMedia(photo.mediaId!)).resolves.toEqual(expected.card)
        expect(presses()).toBe(1)
    })

    it('returns the bytes for the computer and keeps the card file', async () => {
        const { camera, presses, expected } = simulate()
        const photo = await camera.takePhoto({ destination: 'computer' })
        expect(photo).toEqual({
            destination: 'computer',
            mediaId: encodeMediaId(expected.reference),
            name,
            sizeBytes: expected.sizeBytes,
            data: expected.computer,
        })
        expect(presses()).toBe(1)
    })

    it('reports a release the camera refuses as refused', async () => {
        const { camera, refuse } = simulate()
        refuse()
        const refused = await camera.takePhoto().catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).toMatchObject({ operation: 'takePhoto' })
    }, 15000)

    it('reports an unconfirmed release as unknown and never presses again', async () => {
        vi.useFakeTimers()
        const { camera, presses, lose } = simulate()
        lose()
        const outcome = camera.takePhoto().catch(error => error)
        await vi.advanceTimersByTimeAsync(20000)
        const unknown = await outcome
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown).toMatchObject({ operation: 'takePhoto' })
        expect(presses()).toBe(1)
    })

    it('is refused while the camera reports a recording, so Stop never waits behind it', async () => {
        const { camera, presses } = simulate()
        vi.spyOn(camera, 'getRecordingState').mockResolvedValue('recording')
        const refused = await camera.takePhoto().catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused.message).toContain('recording')
        expect(presses()).toBe(0)
    })
})

describe('takePhoto outcomes around the release', () => {
    it('refuses a Canon AF release that cannot lock focus and never releases again without focus', async () => {
        const { camera, body, refuse } = canonBody()
        refuse()
        const refused = await camera.takePhoto().catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused.message).toContain('could not lock focus')
        expect(body.focusPresses).toEqual(['AF'])
    })

    it('reports a failure before the shutter as refused, never as a plain error', async () => {
        const { camera, presses, resumeShooting } = sonyBody()
        resumeShooting.mockRejectedValueOnce(new Error('USB transfer stalled'))
        const refused = await camera.takePhoto().catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused.message).toContain('USB transfer stalled')
        expect(presses()).toBe(0)
    })

    it('reports a mode restoration that fails after a confirmed photo as unknown, never refused', async () => {
        const { camera, body, presses } = sonyBody()
        body.movieMode = true
        body.restoresMovieMode = false
        const unknown = await camera.takePhoto().catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown.message).toContain('The photo was taken')
        expect(presses()).toBe(1)
    })

    it('returns a Sony photo without a media id when the body offers no card index', async () => {
        const { camera, body, presses } = sonyBody()
        body.cardIndex = 'unsupported'
        const photo = await camera.takePhoto()
        expect(photo).toEqual({ destination: 'card', name: 'DSC00001.JPG', sizeBytes: jpeg.length })
        expect(presses()).toBe(1)
    })

    it('reads the Sony card index once, after the camera announces the photo, and never lists handles', async () => {
        const { camera } = sonyBody()
        const send = vi.mocked(protocolSession(camera).driver.send)
        const photo = await camera.takePhoto()
        expect(photo.mediaId).toBeDefined()
        const names = send.mock.calls.map(([operation]) => operation.name)
        expect(names.filter(name => name === 'SDIO_GetContentInfoList')).toHaveLength(1)
        expect(names).not.toContain('GetObjectHandles')
    })

    it('reports a Sony photo its card index never lists as unknown, pressing once', async () => {
        vi.useFakeTimers()
        const { camera, body, presses } = sonyBody()
        body.cardIndex = 'never'
        const outcome = camera.takePhoto().catch(error => error)
        await vi.advanceTimersByTimeAsync(15000)
        const unknown = await outcome
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown.message).toContain('did not list the new file in its card index')
        expect(presses()).toBe(1)
    })

    it('takes the JPEG of a Nikon RAW+JPEG pair announced in separate polls', async () => {
        const { camera, body } = nikonBody()
        body.writes = [[0x00010102], [], [0x00010101]]
        const photo = await camera.takePhoto()
        expect(photo.name).toBe('DSC_0001.JPG')
        expect(decodeMediaId('downloadMedia', photo.mediaId!)).toMatchObject({ objectHandle: 0x00010101 })
    })

    it('takes the Nikon RAW once no JPEG follows it within the pair grace', async () => {
        const { camera, body } = nikonBody()
        body.writes = [[0x00010102]]
        const photo = await camera.takePhoto()
        expect(photo.name).toBe('DSC_0001.NEF')
        expect(body.presses).toBe(1)
    })
})

describe('takePhoto requests a camera cannot do', () => {
    it('reports a release without autofocus on standard PTP as unsupported, sending nothing', async () => {
        const { camera, presses } = standardBody()
        const outcome = await camera.takePhoto({ autofocus: false }).catch(error => error)
        expect(outcome).toBeInstanceOf(CameraUnsupportedError)
        expect(presses()).toBe(0)
    })

    it('refuses a destination that is not the card or the computer before anything is sent', async () => {
        const { camera, presses } = nikonBody()
        const destination: string = 'memory'
        const outcome = await camera.takePhoto({ destination: destination as 'card' }).catch(error => error)
        expect(outcome).toBeInstanceOf(CameraRefusedError)
        expect(presses()).toBe(0)
    })

    it('types the photo by destination', () => {
        const camera = new Camera({ transport: transport() })
        // Type-only: never called, so nothing reaches the transport.
        const cardId = () => camera.takePhoto().then(photo => photo.mediaId)
        expectTypeOf(cardId).returns.resolves.toEqualTypeOf<string | undefined>()
        const computerBytes = () => camera.takePhoto({ destination: 'computer' }).then(photo => photo.data)
        expectTypeOf(computerBytes).returns.resolves.toEqualTypeOf<Uint8Array>()
        // @ts-expect-error A card photo carries no bytes.
        const cardBytes = () => camera.takePhoto({ destination: 'card' }).then(photo => photo.data)
        void cardBytes
    })
})
