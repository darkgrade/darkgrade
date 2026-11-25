/**
 * Zoom, live view, the lens readout and the digitalZoom/liveViewQuality settings through the
 * public Camera API, on simulated Sony, Canon, Nikon and standard PTP bodies. Replies are encoded
 * with the real codecs (Sony SDIO inventories, Nikon/standard descriptors, Canon event records)
 * and the Sony focus frames come from a real a7 V live-view capture.
 */
import type { CanonCamera } from '@camera/canon-camera'
import type { LiveViewFrame } from '@camera/driver/live-view'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@camera/nikon-camera'
import type { LiveViewQuality } from '@camera/settings/live-view'
import type { DigitalZoom } from '@camera/settings/video'
import type { SonyCamera } from '@camera/sony-camera'
import { PTPTimeoutError } from '@core/ptp-errors'
import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import type { NikonLiveViewDataset } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import { SDIDevicePropInfoArrayCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const OK = 0x2001
const transport = () =>
    ({
        isLittleEndian: () => true,
        isConnected: () => true,
        on: () => undefined,
        getType: () => TransportType.USB,
    }) as unknown as TransportInterface

function concatenate(parts: Uint8Array[]): Uint8Array {
    const wire = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
    let offset = 0
    for (const part of parts) {
        wire.set(part, offset)
        offset += part.length
    }
    return wire
}

function deviceInfo(camera: Camera, properties: number[], operations: number[]): DeviceInfo {
    const codec = new DeviceInfoCodec(camera.getInstance().registry)
    return codec.decode(
        codec.encode({
            standardVersion: 100,
            vendorExtensionID: 0,
            vendorExtensionVersion: 100,
            vendorExtensionDesc: '',
            functionalMode: 0,
            operationsSupportedRaw: operations,
            operationsSupportedDecoded: [],
            eventsSupportedRaw: [],
            eventsSupportedDecoded: [],
            devicePropertiesSupported: properties,
            devicePropertiesSupportedDecoded: [],
            captureFormats: [],
            imageFormatsRaw: [],
            imageFormatsDecoded: [],
            manufacturer: 'Fixture',
            model: 'Fixture',
            deviceVersion: '1',
            serialNumber: '',
        })
    ).value
}

const INT8 = 0x0001
const UINT8 = 0x0002
const UINT32 = 0x0006
const STRING = 0xffff

/** One Sony SDIO property as the body reports it. Enabled 1 is enabled; 0 is off (value does not apply). */
interface SonyProperty {
    code: number
    datatype: number
    writable: boolean
    enabled: 0 | 1
    value: number | string
    choices?: number[]
    range?: { minimum: number; maximum: number; step: number }
}

const LENS_MODEL_NAME = 0xd07b
const ZOOM_DISTANCE = 0xd00b
const ZOOM_ENABLE_STATUS = 0xd25b
const ZOOM_SPEED = 0xd25e
const ZOOM_SETTING = 0xd25f
const LIVE_VIEW_STATUS = 0xd221
const LIVE_VIEW_IMAGE_QUALITY = 0xd26a
const OSD_IMAGE_MODE = 0xd207
const ZOOM_OPERATION = 0xd2dd

/** A real a7 V FocalFrameInfo: Flexible Spot S at (500, 400) on the 640×480 grid. */
const a7vFocalFrames = new Uint8Array(
    readFileSync(new URL('./fixtures/sony-a7v-focal-frame-flexible-spot.bin', import.meta.url))
)
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** Sony's live-view dataset: four uint32 offsets and sizes, then the image and the focal frames. */
function sonyLiveViewDataset(): Uint8Array {
    const header = new Uint8Array(16)
    const view = new DataView(header.buffer)
    view.setUint32(0, 16, true)
    view.setUint32(4, jpeg.length, true)
    view.setUint32(8, 16 + jpeg.length, true)
    view.setUint32(12, a7vFocalFrames.length, true)
    return concatenate([header, jpeg, a7vFocalFrames])
}

/** Sony's OSD dataset: offsets and sizes, then the PNG. */
function sonyOsdDataset(): Uint8Array {
    const header = new Uint8Array(16)
    const view = new DataView(header.buffer)
    view.setUint32(0, 16, true)
    view.setUint32(4, png.length, true)
    return concatenate([header, png])
}

/**
 * Simulated Sony body with a power-zoom lens: while a zoom operation is active, every inventory
 * read moves ZoomDistance by `stepMillimetres` towards the zoom direction, within the lens range.
 */
function sonyBody(options: { zoomAvailable?: boolean; powerZoom?: boolean; focalReported?: boolean } = {}) {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = camera.getInstance() as SonyCamera
    const registry = driver.registry
    const properties = new Map<number, SonyProperty>()
    const add = (property: SonyProperty) => properties.set(property.code, property)
    add({ code: LENS_MODEL_NAME, datatype: STRING, writable: false, enabled: 1, value: 'E PZ 18-105mm F4 G OSS' })
    add({
        code: ZOOM_DISTANCE,
        datatype: UINT32,
        writable: false,
        enabled: options.focalReported === false ? 0 : 1,
        value: 18_000,
    })
    add({
        code: ZOOM_ENABLE_STATUS,
        datatype: UINT8,
        writable: false,
        enabled: 1,
        value: options.zoomAvailable === false ? 0 : 1,
        choices: [0, 1],
    })
    add({
        code: ZOOM_SPEED,
        datatype: INT8,
        writable: false,
        enabled: 1,
        value: 0,
        range: { minimum: -8, maximum: 8, step: 1 },
    })
    add({ code: ZOOM_SETTING, datatype: UINT8, writable: true, enabled: 1, value: 1, choices: [1, 3, 4] })
    add({ code: LIVE_VIEW_STATUS, datatype: UINT8, writable: false, enabled: 1, value: 1 })
    add({ code: LIVE_VIEW_IMAGE_QUALITY, datatype: UINT8, writable: true, enabled: 1, value: 2, choices: [1, 2] })
    add({ code: OSD_IMAGE_MODE, datatype: UINT8, writable: true, enabled: 1, value: 0, choices: [0, 1] })
    const body = {
        properties,
        applies: true,
        zoomDirection: 0,
        stepMillimetres: 2,
        lensRange: { minimum: 18, maximum: 105 },
        zoomReply: OK,
        stopReply: OK,
        zoomStartThrows: undefined as Error | undefined,
    }
    const sent: string[] = []
    const zoomCommands: number[] = []
    const writes: { code: number; raw: number }[] = []
    const encode = (datatype: number, value: number | string) =>
        new VariableValueCodec(registry, datatype).encode(value)
    const inventory = () => {
        const focal = properties.get(ZOOM_DISTANCE)!
        if (body.zoomDirection !== 0 && options.powerZoom !== false) {
            const next = Number(focal.value) / 1000 + body.zoomDirection * body.stepMillimetres
            focal.value = Math.round(Math.min(body.lensRange.maximum, Math.max(body.lensRange.minimum, next)) * 1000)
        }
        const entries = [...properties.values()].map(property => {
            const form = property.range
                ? [
                      Uint8Array.of(1),
                      encode(property.datatype, property.range.minimum),
                      encode(property.datatype, property.range.maximum),
                      encode(property.datatype, property.range.step),
                  ]
                : property.choices
                  ? [
                        Uint8Array.of(2),
                        registry.codecs.uint16.encode(property.choices.length),
                        ...property.choices.map(choice => encode(property.datatype, choice)),
                        registry.codecs.uint16.encode(property.choices.length),
                        ...property.choices.map(choice => encode(property.datatype, choice)),
                    ]
                  : [Uint8Array.of(0)]
            return concatenate([
                registry.codecs.uint16.encode(property.code),
                registry.codecs.uint16.encode(property.datatype),
                Uint8Array.of(property.writable ? 1 : 0),
                Uint8Array.of(property.enabled),
                encode(property.datatype, property.value),
                encode(property.datatype, property.value),
                ...form,
            ])
        })
        const wire = concatenate([
            registry.codecs.uint32.encode(entries.length),
            registry.codecs.uint32.encode(0),
            ...entries,
        ])
        return new SDIDevicePropInfoArrayCodec(registry).decode(wire).value
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        sent.push(operation.name)
        switch (operation.name) {
            case 'GetDeviceInfo':
                return { code: OK, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205, 0x9207, 0x9238]) }
            case 'SDIO_GetAllExtDevicePropInfo':
                return { code: OK, data: inventory() }
            case 'SDIO_SetExtDevicePropValue': {
                const property = properties.get(parameters.DevicePropCode)!
                const raw = Number(new VariableValueCodec(registry, property.datatype).decode(data!).value.value)
                writes.push({ code: property.code, raw })
                if (body.applies) property.value = raw
                return { code: OK }
            }
            case 'SDIO_ControlDevice': {
                if (parameters.sdiControlCode !== ZOOM_OPERATION) return { code: OK }
                const speed = registry.codecs.int8.decode(data!).value
                zoomCommands.push(speed)
                if (speed !== 0 && body.zoomStartThrows) throw body.zoomStartThrows
                const reply = speed === 0 ? body.stopReply : body.zoomReply
                if (reply === OK) body.zoomDirection = Math.sign(speed)
                return { code: reply }
            }
            case 'GetObject':
                return { code: OK, data: sonyLiveViewDataset() }
            case 'SDIO_GetOsdImage':
                return { code: OK, data: sonyOsdDataset() }
        }
        throw new Error(`Unexpected Sony operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, sent, zoomCommands, writes }
}

/** Simulated Nikon body in photo mode, with the standard FocalLength property (hundredths of a mm). */
function nikonBody(metadata?: Partial<NikonLiveViewDataset>) {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = camera.getInstance() as NikonCamera
    driver.sessionId = 1
    const registry = driver.registry
    const selector = registry.properties.LiveViewSelector.code
    const sent: string[] = []
    const descriptor = (code: number, type: number, value: number, writable: boolean) => {
        const codec = new VariableValueCodec(registry, type)
        const wire = concatenate([
            registry.codecs.uint32.encode(code),
            registry.codecs.uint16.encode(type),
            Uint8Array.of(writable ? 1 : 0),
            codec.encode(value),
            codec.encode(value),
            Uint8Array.of(0),
        ])
        return new DevicePropDescCodec(registry, true).decode(wire).value
    }
    const frame: NikonLiveViewDataset = {
        majorVersion: 1,
        minorVersion: 0,
        displayInfoSize: 0,
        liveViewImageSize: jpeg.length,
        wholeSize: { horizontal: 6000, vertical: 4000 },
        displayAreaSize: { horizontal: 6000, vertical: 4000 },
        displayCenterCoords: { horizontal: 3000, vertical: 2000 },
        liveViewImageImageSize: { horizontal: 640, vertical: 424 },
        liveViewImageQuality: 0,
        afDrivingEnabled: 1,
        focusDrivingStatus: 0,
        focusingJudgementResult: 2,
        afModeState: 0,
        afAreaNumber: 1,
        selectedSubjectIndex: 0,
        trackingState: 0,
        afFrameSize: { horizontal: 600, vertical: 400 },
        afFrameCenterCoords: { horizontal: 1500, vertical: 1000 },
        liveViewImage: jpeg,
        ...metadata,
    } as NikonLiveViewDataset
    const send = async (operation: OperationDefinition, parameters: Record<string, number>) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo')
            return { code: OK, data: deviceInfo(camera, [selector, 0x5008], [0x1001, 0x1015, 0x9201, 0x9203]) }
        if (operation.name === 'GetVendorCodes') return { code: OK, data: registry.codecs.uint32.encode(0) }
        if (operation.name === 'GetLiveViewImageEx') return { code: OK, data: frame }
        const code = parameters.DevicePropCode
        if (code === selector) return { code: OK, data: descriptor(selector, UINT8, 0, true) }
        return { code: 0x200a }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    // Decoded property values: photo mode, live view already on, and FocalLength 5000 (hundredths of a mm).
    vi.spyOn(driver, 'get').mockImplementation((async (property: { code: number }) =>
        property.code === 0x5008 ? 5000 : property.code === selector ? 'PHOTO' : 'ON') as never)
    return { camera, sent }
}

/** Simulated Canon body: an empty event inventory and one viewfinder frame. */
function canonBody() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = camera.getInstance() as CanonCamera
    const sent: string[] = []
    const send = async (operation: OperationDefinition) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo')
            return { code: OK, data: deviceInfo(camera, [], [0x1001, 0x9116, 0x9153]) }
        if (operation.name === 'CanonGetEventData') {
            const wire = new Uint8Array(8)
            new DataView(wire.buffer).setUint32(0, 8, true)
            return { code: OK, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
        }
        throw new Error(`Unexpected Canon operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    vi.spyOn(driver, 'captureViewfinderFrame').mockResolvedValue({ image: jpeg, segments: [] })
    return { camera, sent }
}

/** Standard PTP body: no live view and no zoom; FocalLength is not advertised. */
function standardBody() {
    const camera = new Camera({ transport: transport() })
    const driver = camera.getInstance()
    const sent: string[] = []
    vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo') return { code: OK, data: deviceInfo(camera, [], [0x1001]) }
        return { code: 0x200a }
    }) as never)
    return { camera, sent }
}

describe('lens readout in getCapabilities', () => {
    it('reads the Sony lens name and focal length from the same inventory as the settings', async () => {
        const { camera, sent } = sonyBody()
        const capabilities = await camera.getCapabilities()
        expect(capabilities.lens).toEqual({ name: 'E PZ 18-105mm F4 G OSS', focalLengthMillimetres: 18 })
        expect(capabilities.controls.digitalZoom?.value).toBe('Off')
        expect(sent.filter(name => name === 'SDIO_GetAllExtDevicePropInfo')).toHaveLength(1)
    })

    it('leaves a Sony focal length the body marks disabled unreported, like the a7 V with a manual-zoom lens', async () => {
        const { camera } = sonyBody({ focalReported: false })
        expect((await camera.getCapabilities()).lens).toEqual({
            name: 'E PZ 18-105mm F4 G OSS',
            focalLengthMillimetres: null,
        })
    })

    it('reads the standard FocalLength in hundredths of a millimetre on Nikon', async () => {
        const { camera } = nikonBody()
        expect((await camera.getCapabilities()).lens).toEqual({ name: null, focalLengthMillimetres: 50 })
    })

    it('reports no lens where the camera reports none', async () => {
        expect((await canonBody().camera.getCapabilities()).lens).toBeUndefined()
        expect((await standardBody().camera.getCapabilities()).lens).toBeUndefined()
    })
})

describe('digitalZoom and liveViewQuality typed settings', () => {
    it('reads and writes canonical names, sending the Sony codec value once', async () => {
        const { camera, writes } = sonyBody()
        expect(await camera.getDigitalZoom()).toBe('Off')
        expect(await camera.setDigitalZoom('Clear Image Zoom')).toBe('Clear Image Zoom')
        expect(writes).toEqual([{ code: ZOOM_SETTING, raw: 3 }])
        expect(await camera.getLiveViewQuality()).toBe('High')
        expect(await camera.setLiveViewQuality('Low')).toBe('Low')
        expect(writes.at(-1)).toEqual({ code: LIVE_VIEW_IMAGE_QUALITY, raw: 1 })
        expect((await camera.getCapabilities()).controls.liveViewQuality?.allowedValues).toEqual(['Low', 'High'])
    })

    it('refuses a value the camera does not offer and a vendor word, sending nothing', async () => {
        const { camera, body, writes } = sonyBody()
        body.properties.get(ZOOM_SETTING)!.choices = [1, 3]
        expect(await camera.setDigitalZoom('Digital Zoom').catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(await camera.setControl('digitalZoom', 'Optical Zoom Only').catch(error => error)).toBeInstanceOf(
            CameraRefusedError
        )
        expect(writes).toHaveLength(0)
    })

    it('reports an acknowledged write the camera never shows as unknown, and never resends it', async () => {
        const { camera, body, writes } = sonyBody()
        body.applies = false
        expect(await camera.setLiveViewQuality('Low').catch(error => error)).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(writes).toHaveLength(1)
    }, 15000)

    it('reports both settings unsupported on Canon, Nikon and standard bodies', async () => {
        for (const { camera } of [canonBody(), nikonBody(), standardBody()]) {
            expect(await camera.getDigitalZoom().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
            expect(await camera.setLiveViewQuality('High').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        }
    })

    it('types values from the codecs, in canonical spelling', () => {
        const camera = new Camera({ transport: transport() })
        expectTypeOf(camera.setDigitalZoom).parameter(0).toEqualTypeOf<DigitalZoom>()
        expectTypeOf<DigitalZoom>().toEqualTypeOf<'Off' | 'Clear Image Zoom' | 'Digital Zoom'>()
        expectTypeOf(camera.getLiveViewQuality).returns.resolves.toEqualTypeOf<LiveViewQuality>()
        expectTypeOf<LiveViewQuality>().toEqualTypeOf<'Low' | 'High'>()
        // @ts-expect-error Sony's own word is not the canonical name.
        void camera.setLiveViewQuality('HIGH').catch(() => undefined)
    })
})

describe('Sony zoom', () => {
    it('reports zoom support from the inventory, with the camera reason when unavailable', async () => {
        expect((await sonyBody().camera.getCapabilities()).operations).toMatchObject({
            zoomTo: { supported: true },
            startZoom: { supported: true },
            stopZoom: { supported: true },
        })
        expect((await sonyBody({ zoomAvailable: false }).camera.getCapabilities()).operations).toMatchObject({
            zoomTo: { supported: false, reason: expect.stringMatching(/unavailable/) },
            startZoom: { supported: false, reason: expect.stringMatching(/unavailable/) },
            stopZoom: { supported: true },
        })
        expect((await sonyBody({ focalReported: false }).camera.getCapabilities()).operations?.zoomTo).toMatchObject({
            supported: false,
            reason: expect.stringMatching(/focal length/),
        })
    })

    it('refuses to start when remote zoom is unavailable, sending no zoom command', async () => {
        const { camera, zoomCommands } = sonyBody({ zoomAvailable: false })
        expect(await camera.startZoom('in', { speed: 'fast' }).catch(error => error)).toBeInstanceOf(
            CameraUnsupportedError
        )
        expect(zoomCommands).toEqual([])
    })

    it('maps the named speeds onto the camera speed range and stops by itself after 10 seconds', async () => {
        const { camera, zoomCommands } = sonyBody()
        vi.useFakeTimers()
        await camera.startZoom('in', { speed: 'fast' })
        await camera.startZoom('out', { speed: 'medium' })
        await camera.startZoom('in', { speed: 'slow' })
        expect(zoomCommands).toEqual([8, -4, 1])
        await vi.advanceTimersByTimeAsync(9_999)
        expect(zoomCommands).toEqual([8, -4, 1])
        await vi.advanceTimersByTimeAsync(1)
        expect(zoomCommands).toEqual([8, -4, 1, 0])
    })

    it('stops at once and cancels the safety stop', async () => {
        const { camera, zoomCommands } = sonyBody()
        vi.useFakeTimers()
        await camera.startZoom('out', { speed: 'fast' })
        await camera.stopZoom()
        await vi.advanceTimersByTimeAsync(20_000)
        expect(zoomCommands).toEqual([-8, 0])
    })

    it('reports a refused start as refused and arms no safety stop', async () => {
        const { camera, body, zoomCommands } = sonyBody()
        body.zoomReply = 0x2019
        vi.useFakeTimers()
        expect(await camera.startZoom('in', { speed: 'fast' }).catch(error => error)).toBeInstanceOf(CameraRefusedError)
        await vi.advanceTimersByTimeAsync(20_000)
        expect(zoomCommands).toEqual([8])
    })

    it('reports an unconfirmed start as unknown, never resends it, and still stops by itself', async () => {
        const { camera, body, zoomCommands } = sonyBody()
        body.zoomStartThrows = new PTPTimeoutError('response', 50)
        vi.useFakeTimers()
        expect(await camera.startZoom('in', { speed: 'fast' }).catch(error => error)).toBeInstanceOf(
            CameraOutcomeUnknownError
        )
        expect(zoomCommands).toEqual([8])
        await vi.advanceTimersByTimeAsync(10_000)
        expect(zoomCommands).toEqual([8, 0])
    })

    it('reports a refused stop while zooming, and resolves a refused stop when nothing was moving', async () => {
        const { camera, body } = sonyBody()
        body.stopReply = 0x2019
        await expect(camera.stopZoom()).resolves.toBeUndefined()
        await camera.startZoom('in', { speed: 'slow' })
        expect(await camera.stopZoom().catch(error => error)).toBeInstanceOf(CameraRefusedError)
    })

    it('zooms to a focal length and resolves to where the lens landed, read back', async () => {
        const { camera, body, zoomCommands } = sonyBody()
        const landed = await camera.zoomTo(35)
        expect(Math.abs(landed - 35)).toBeLessThanOrEqual(2)
        expect(Number(body.properties.get(ZOOM_DISTANCE)!.value) / 1000).toBe(landed)
        expect(zoomCommands[0]).toBeGreaterThan(0)
        expect(zoomCommands.filter(speed => speed === 0).length).toBeGreaterThanOrEqual(1)
        expect(zoomCommands.at(-1)).toBe(0)
        expect((await camera.getCapabilities()).lens?.focalLengthMillimetres).toBe(landed)
    })

    it('stops at the end of the lens range and returns the range end, not the request', async () => {
        const { camera, zoomCommands } = sonyBody()
        expect(await camera.zoomTo(200)).toBe(105)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('stops and reports unsupported when the focal length never moves (no power zoom)', async () => {
        const { camera, zoomCommands } = sonyBody({ powerZoom: false })
        expect(await camera.zoomTo(35).catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('refuses a focal length that is not a positive number, and needs a reported focal length', async () => {
        expect(
            await sonyBody()
                .camera.zoomTo(-5)
                .catch(error => error)
        ).toBeInstanceOf(CameraRefusedError)
        const { camera, zoomCommands } = sonyBody({ focalReported: false })
        expect(await camera.zoomTo(35).catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(zoomCommands).toEqual([])
    })
})

describe('zoom on bodies without a zoom command', () => {
    it('reports zoom unsupported, sends nothing, and still allows stopZoom', async () => {
        for (const { camera, sent } of [canonBody(), nikonBody(), standardBody()]) {
            const operations = (await camera.getCapabilities()).operations
            expect(operations?.startZoom).toMatchObject({ supported: false })
            expect(operations?.zoomTo).toMatchObject({ supported: false })
            const before = sent.length
            expect(await camera.startZoom('in', { speed: 'fast' }).catch(error => error)).toBeInstanceOf(
                CameraUnsupportedError
            )
            expect(await camera.zoomTo(35).catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
            await expect(camera.stopZoom()).resolves.toBeUndefined()
            expect(sent).toHaveLength(before)
        }
    })
})

describe('getLiveViewFrame', () => {
    it('returns the Sony JPEG with the camera focus frames normalized to the picture', async () => {
        const { camera } = sonyBody()
        const frame: LiveViewFrame = await camera.getLiveViewFrame()
        expect(frame.jpeg).toEqual(jpeg)
        expect(frame.overlay).toBeUndefined()
        expect(frame.focusFrames).toHaveLength(1)
        const [focus] = frame.focusFrames
        expect(focus).toMatchObject({ kind: 'focus', focused: false })
        expect(focus!.centerX).toBeCloseTo(500 / 640)
        expect(focus!.centerY).toBeCloseTo(400 / 480)
        expect(focus!.width).toBeCloseTo(38 / 640)
    })

    it('adds the camera on-screen display on request and switches its output off once overlays stop', async () => {
        const { camera, body, writes } = sonyBody()
        const options = (await camera.getCapabilities()).operations?.getLiveViewFrame?.options
        expect(options?.overlay).toEqual({ supported: true })
        const withOverlay = await camera.getLiveViewFrame({ overlay: true })
        expect(withOverlay.overlay?.png).toEqual(png)
        expect(body.properties.get(OSD_IMAGE_MODE)!.value).toBe(1)
        await camera.getLiveViewFrame()
        expect(body.properties.get(OSD_IMAGE_MODE)!.value).toBe(1)
        const now = Date.now()
        vi.spyOn(Date, 'now').mockReturnValue(now + 2_500)
        await camera.getLiveViewFrame()
        expect(body.properties.get(OSD_IMAGE_MODE)!.value).toBe(0)
        expect(writes.filter(write => write.code === OSD_IMAGE_MODE).map(write => write.raw)).toEqual([1, 0])
    })

    it('normalizes the Nikon AF frame over the displayed area, also when magnified', async () => {
        const whole = await nikonBody().camera.getLiveViewFrame()
        expect(whole.jpeg).toEqual(jpeg)
        expect(whole.focusFrames).toEqual([
            { kind: 'focus', focused: true, centerX: 0.25, centerY: 0.25, width: 0.1, height: 0.1 },
        ])
        const magnified = await nikonBody({
            displayAreaSize: { horizontal: 3000, vertical: 2000 },
            displayCenterCoords: { horizontal: 1500, vertical: 1000 },
            focusingJudgementResult: 1,
        }).camera.getLiveViewFrame()
        expect(magnified.focusFrames).toEqual([
            { kind: 'focus', focused: false, centerX: 0.5, centerY: 0.5, width: 0.2, height: 0.2 },
        ])
    })

    it('returns the Canon picture without inventing focus frames', async () => {
        const frame = await canonBody().camera.getLiveViewFrame()
        expect(frame).toEqual({ jpeg, focusFrames: [] })
    })

    it('reports an overlay unsupported on Canon and Nikon before sending anything', async () => {
        for (const { camera, sent } of [canonBody(), nikonBody()]) {
            const options = (await camera.getCapabilities()).operations?.getLiveViewFrame?.options
            expect(options?.overlay).toMatchObject({ supported: false })
            const before = sent.length
            expect(await camera.getLiveViewFrame({ overlay: true }).catch(error => error)).toBeInstanceOf(
                CameraUnsupportedError
            )
            expect(sent).toHaveLength(before)
        }
    })

    it('reports live view unsupported on a standard PTP body', async () => {
        const { camera } = standardBody()
        expect((await camera.getCapabilities()).operations?.getLiveViewFrame).toMatchObject({ supported: false })
        expect(await camera.getLiveViewFrame().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
    })

    it('reports Sony live view unavailable in the current mode as unsupported, without requesting an image', async () => {
        const { camera, body, sent } = sonyBody()
        body.properties.get(LIVE_VIEW_STATUS)!.value = 2
        expect((await camera.getCapabilities()).operations?.getLiveViewFrame).toMatchObject({ supported: false })
        expect(await camera.getLiveViewFrame().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(sent).not.toContain('GetObject')
    })
})
