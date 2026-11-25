/**
 * takePhoto end to end on simulated Sony, Canon, Nikon and standard PTP bodies. Object
 * information is encoded and decoded with the real ObjectInfo codec and events arrive with their
 * wire codes. Each vendor covers a confirmed photo (card and computer), a refused release, an
 * unsupported request and a release the camera never confirms, which is never repeated.
 */
import type { CanonCamera } from '@camera/canon-camera'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@camera/nikon-camera'
import type { SonyCamera } from '@camera/sony-camera'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined, getType: () => 'usb' }) as unknown as TransportInterface

const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)

/** An ObjectInfo reply exactly as the codec decodes it from the wire. */
function objectInfo(camera: Camera, filename: string, size = jpeg.length, associationType = 0): ObjectInfo {
    const codec = new ObjectInfoCodec(camera.getInstance().registry)
    return codec.decode(
        codec.encode({
            storageID: 0x00010001,
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

/** Delivers an event the way the transport does (the driver's event handler is internal). */
function emit(driver: object, event: { code: number; parameters: number[] }) {
    const handleEvent: (event: { code: number; parameters: number[]; transactionId: number }) => void =
        Reflect.get(driver, 'handleEvent')
    handleEvent.call(driver, { ...event, transactionId: 0 })
}

type Send = (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) => Promise<unknown>

/** Sony: two-stage release through the driver's button properties; the body adds 0xFFFFC001 for the host. */
function sonyBody() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = camera.getInstance() as SonyCamera
    const body = { delivers: true, focuses: true, presses: 0 }
    vi.spyOn(driver, 'resumeShooting').mockResolvedValue()
    // The save destination reads as writable again once the body has finished with the shot.
    const propertyCache: Map<number, unknown> = Reflect.get(driver, 'propertyCache')
    vi.spyOn(driver, 'refreshPropertyStates').mockImplementation(async () => {
        propertyCache.set(driver.registry.properties.StillImageSaveDestination.code, { vendorExtensions: { enabled: true } })
        return []
    })
    // Live view is the driver's own business here; the release sequence is under test.
    Object.assign(driver, { startLiveView: async () => undefined })
    vi.spyOn(driver, 'get').mockImplementation(async property =>
        (property.name === 'FocusIndication' ? (body.focuses ? 'AF_S_FOCUSED' : 'AF_S_NOT_FOCUSED') : 'CAMERA_DEVICE') as never
    )
    vi.spyOn(driver, 'set').mockImplementation(async (property, value) => {
        if (property.name !== 'ShutterReleaseButton' || value !== 'DOWN') return
        body.presses++
        if (body.delivers) emit(driver, { code: 0xc201, parameters: [0xffffc001] })
    })
    const send: Send = async operation => {
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: objectInfo(camera, 'DSC00001.JPG') }
        if (operation.name === 'GetObject') return { code: 0x2001, data: jpeg }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        presses: () => body.presses,
        refuse: () => (body.focuses = false),
        lose: () => (body.delivers = false),
        unsupported: undefined,
    }
}

/** Canon: RemoteReleaseOn presses, confirmed by a new handle on the card (a card diff). */
function canonBody() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = camera.getInstance() as CanonCamera
    const body = { handles: [1], refuses: false, writes: true, presses: 0 }
    vi.spyOn(driver, 'listUnknownPropertyStates').mockReturnValue([])
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    const send: Send = async (operation, parameters) => {
        if (operation.name === 'GetStorageIDs') return { code: 0x2001, data: [0x00010001] }
        if (operation.name === 'GetObjectHandles') return { code: 0x2001, data: [...body.handles] }
        if (operation.name === 'CanonRemoteReleaseOn' && parameters.ReleaseMode === 'SHUTTER') {
            body.presses++
            if (body.refuses) return { code: 0x2019 }
            if (body.writes) body.handles.push(2)
        }
        if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: objectInfo(camera, 'IMG_0002.JPG') }
        return { code: 0x2001, parameters: [] }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        presses: () => body.presses,
        // A full press refused twice (AF then the documented no-AF fallback): nothing was taken.
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = false),
        unsupported: undefined,
    }
}

/** Nikon: InitiateCapture, then ObjectAdded queued for GetEventEx once the file is on the card. */
function nikonBody() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = camera.getInstance() as NikonCamera
    driver.sessionId = 1
    const body = { queued: [] as { code: number; parameters: number[] }[], refuses: false, writes: true, presses: 0 }
    vi.spyOn(driver, 'get').mockImplementation(async property =>
        (property.name === 'LiveViewSelector' ? 'PHOTO' : property.name === 'LiveViewStatus' ? 'ON' : 'OFF') as never
    )
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    const send: Send = async (operation, parameters) => {
        if (operation.name === 'InitiateCapture') {
            body.presses++
            if (body.refuses) return { code: 0x2019 }
            // A new folder is announced too; it is never taken for the photo.
            if (body.writes) body.queued.push({ code: 0x4002, parameters: [0x00010100] }, { code: 0x4002, parameters: [0x00010101] })
        }
        if (operation.name === 'GetEventEx') return { code: 0x2001, data: body.queued.splice(0) }
        if (operation.name === 'GetObjectInfo')
            return {
                code: 0x2001,
                data: parameters.ObjectHandle === 0x00010100
                    ? objectInfo(camera, '100NCZ_5', 0, 1)
                    : objectInfo(camera, 'DSC_0001.JPG'),
            }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        presses: () => body.presses,
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = false),
        unsupported: undefined,
    }
}

/** Standard PTP: InitiateCapture, confirmed by an ObjectAdded event on the interrupt pipe. */
function standardBody() {
    const camera = new Camera({ transport: transport() })
    const driver = camera.getInstance()
    const body = { refuses: false, writes: true, presses: 0 }
    vi.spyOn(driver, 'getObject').mockResolvedValue(jpeg)
    const send: Send = async operation => {
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
    return {
        camera,
        body,
        presses: () => body.presses,
        refuse: () => (body.refuses = true),
        lose: () => (body.writes = false),
        // Standard PTP documents no release without autofocus.
        unsupported: { autofocus: false } as const,
    }
}

const vendors = [
    ['Sony', sonyBody, 'DSC00001.JPG'],
    ['Canon', canonBody, 'IMG_0002.JPG'],
    ['Nikon', nikonBody, 'DSC_0001.JPG'],
    ['standard PTP', standardBody, 'P0000001.JPG'],
] as const

describe.each(vendors)('takePhoto on a simulated %s body', (_vendor, simulate, name) => {
    it('resolves to the new card file, once', async () => {
        const { camera, presses } = simulate()
        const photo = await camera.takePhoto()
        expect(photo).toEqual({ destination: 'card', mediaId: `20261124T120000/${name}`, name, sizeBytes: jpeg.length })
        expect(presses()).toBe(1)
    })

    it('returns the bytes for the computer and keeps the card file', async () => {
        const { camera, presses } = simulate()
        const photo = await camera.takePhoto({ destination: 'computer' })
        expect(photo).toEqual({
            destination: 'computer',
            mediaId: `20261124T120000/${name}`,
            name,
            sizeBytes: jpeg.length,
            data: jpeg,
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
})

describe('takePhoto requests a camera cannot do', () => {
    it('reports a release without autofocus on standard PTP as unsupported, sending nothing', async () => {
        const { camera, presses, unsupported } = standardBody()
        const outcome = await camera.takePhoto(unsupported).catch(error => error)
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
        expectTypeOf(cardId).returns.resolves.toEqualTypeOf<string>()
        const computerBytes = () => camera.takePhoto({ destination: 'computer' }).then(photo => photo.data)
        expectTypeOf(computerBytes).returns.resolves.toEqualTypeOf<Uint8Array>()
        // @ts-expect-error A card photo carries no bytes.
        const cardBytes = () => camera.takePhoto({ destination: 'card' }).then(photo => photo.data)
        void cardBytes
    })
})
