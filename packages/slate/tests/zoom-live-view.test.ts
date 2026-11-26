/**
 * Zoom, live view, the lens readout and the digitalZoom/liveViewQuality settings through the
 * public Camera API, on simulated Sony, Canon, Nikon and standard PTP bodies. Replies are encoded
 * with the real codecs (Sony SDIO inventories, Nikon/standard descriptors, Canon event records)
 * and the Sony focus frames come from a real a7 V live-view capture.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { LiveViewFrame } from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { parseSonyFocalFrameInfo } from '@vendors/sony/focal-frame-info'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { PTPTimeoutError } from '@core/ptp-errors'
import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { CanonLiveViewDatasetCodec } from '@vendors/canon/datasets/canon-live-view-dataset'
import { NikonLiveViewDatasetCodec } from '@vendors/nikon/datasets/nikon-live-view-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { canonEvents, canonValue } from '@tests/fixtures/canon-events'
import { concatenate, deviceInfo, fakeTransport, propertyDescriptor, sonyPropertyInventory, syntheticJpeg } from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const OK = 0x2001
const transport = () => fakeTransport({ getType: () => TransportType.USB })

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
const ZOOM_SCALE = 0xd25c

/** A real a7 V FocalFrameInfo: Flexible Spot S at (500, 400) on the 640×480 grid. */
const a7vFocalFrames = new Uint8Array(
    readFileSync(new URL('./fixtures/sony-a7v-focal-frame-flexible-spot.bin', import.meta.url))
)
const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** Sony's live-view dataset: four uint32 offsets and sizes, then the image and the focal frames. */
function sonyLiveViewDataset(image: Uint8Array = jpeg): Uint8Array {
    const header = new Uint8Array(16)
    const view = new DataView(header.buffer)
    view.setUint32(0, 16, true)
    view.setUint32(4, image.length, true)
    view.setUint32(8, 16 + image.length, true)
    view.setUint32(12, a7vFocalFrames.length, true)
    return concatenate([header, image, a7vFocalFrames])
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
 * How the simulated power-zoom lens moves, in time, as measured on the darkgrade01 a6700 (firmware
 * 2.00) with the E PZ 16-50mm II on 2026-11-25 (traces df92ae65, 531e466f, 8290f064, edd5f2b8,
 * 0b3dfb8e, 84500d79, 1cfe79a5, 057ebf9b).
 */
interface LensMechanics {
    /** Millimetres a second at a zoom speed level (1–8) and focal length: speed 1 about 12 at wide, 20 near tele. */
    rate: (level: number, position: number) => number
    /** Millimetres the lens goes on after the stop, by level and direction (+1 tele, -1 wide). */
    coast: (level: number, sign: number) => number
    /** From an accepted start to the lens moving. */
    startMs: number
    /** Extra delay before a movement against the last one (gear backlash). */
    reversalMs: number
    /** ZoomDistance shows where the lens was this long before... */
    lagMs: number
    /** ...sampled at these intervals in turn (the camera's own update cadence)... */
    updateMs: readonly number[]
    /** ...rounded to this step: whole millimetres on the a6700, whatever the descriptor says. */
    stepMillimetres: number
    /** Each inventory read takes this long. */
    readMs: number
    /** When set, the lens can rest only on multiples of this (a stepped zoom). */
    detentMillimetres?: number
    /** A stop sooner than this after a fresh start leaves the lens where it was: the motor never engaged. */
    minimumPulseMs?: number
}

/** The bench a6700 with the E PZ 16-50mm II. */
const A6700_PZ_16_50: LensMechanics = {
    rate: (level, position) => {
        const tele = Math.min(1, Math.max(0, (position - 16) / 34))
        if (level <= 1) return 12 + 8 * tele
        if (level <= 4) return 35 + 20 * tele
        return 70 + 20 * tele
    },
    coast: (level, sign) => (level <= 1 ? (sign > 0 ? 2.5 : 2.5) : level <= 4 ? 8 : 12),
    startMs: 30,
    reversalMs: 0,
    lagMs: 150,
    updateMs: [180, 220, 160, 250, 200],
    stepMillimetres: 1,
    // Each read takes about 80 ms on the bench; tests that time a zoom on fake timers set it.
    readMs: 0,
    // A pulse of about 4 ms left the bench lens where it was; 141 ms moved it (SUITE5b-3491b29a, Z5restore3-5ac3113a).
    minimumPulseMs: 100,
}

/**
 * Simulated Sony body with a power-zoom lens moving in time by `mechanics` (the fake clock while a
 * test runs on fake timers): ZoomDistance trails it by the lag, changes at the camera's own update
 * cadence, in whole millimetres, and the lens coasts on after a stop. ZoomSpeed reads 0 throughout,
 * as the a6700's does while moving.
 */
function sonyBody(
    options: {
        zoomAvailable?: boolean
        powerZoom?: boolean
        focalReported?: boolean
        /** Optical Zoom Only (1), Clear Image Zoom (3) or Digital Zoom (4). */
        zoomSetting?: number
        /** Reports Zoom Scale (thousandths), which digital zoom moves when the lens cannot. */
        zoomScaleReported?: boolean
        lens?: LensMechanics
        lensName?: string
        position?: number
        lensRange?: { minimum: number; maximum: number }
    } = {}
) {
    const mechanics = options.lens ?? A6700_PZ_16_50
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const registry = driver.registry
    const properties = new Map<number, SonyProperty>()
    const add = (property: SonyProperty) => properties.set(property.code, property)
    add({ code: LENS_MODEL_NAME, datatype: STRING, writable: false, enabled: 1, value: options.lensName ?? 'E PZ 18-105mm F4 G OSS' })
    add({
        code: ZOOM_DISTANCE,
        datatype: UINT32,
        writable: false,
        enabled: options.focalReported === false ? 0 : 1,
        value: Math.round((options.position ?? 18) * 1000),
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
    add({
        code: ZOOM_SETTING,
        datatype: UINT8,
        writable: true,
        enabled: 1,
        value: options.zoomSetting ?? 1,
        choices: [1, 3, 4],
    })
    if (options.zoomScaleReported) add({ code: ZOOM_SCALE, datatype: UINT32, writable: false, enabled: 1, value: 1000 })
    add({ code: LIVE_VIEW_STATUS, datatype: UINT8, writable: false, enabled: 1, value: 1 })
    add({ code: LIVE_VIEW_IMAGE_QUALITY, datatype: UINT8, writable: true, enabled: 1, value: 2, choices: [1, 2] })
    add({ code: OSD_IMAGE_MODE, datatype: UINT8, writable: true, enabled: 1, value: 0, choices: [0, 1] })
    const lensRange = options.lensRange ?? { minimum: 18, maximum: 105 }
    const body = {
        properties,
        /** Where the lens is now. */
        position: options.position ?? 18,
        /** Where each stop left the lens, in order. */
        rests: [] as number[],
        zoomReply: OK,
        stopReply: OK,
        zoomStartThrows: undefined as Error | undefined,
        /** While set, inventory reads wait for it: a start still being prepared. */
        inventoryGate: undefined as Promise<void> | undefined,
        /** The reply to writing OsdImageMode off. */
        osdOffReply: OK,
        /** The pictures the next live-view reads carry, in order; then the plain test JPEG. */
        liveViewImages: [] as Uint8Array[],
    }
    const sent: string[] = []
    const zoomCommands: number[] = []
    const writes: { code: number; raw: number }[] = []

    // The lens in time. The clock only moves forward: a test switching back to real timers (behind
    // the fake clock) leaves the lens where the fake clock left it.
    const STEP_MS = 2
    let clock = 0
    let lastNow = Date.now()
    const now = () => {
        const real = Date.now()
        if (real > lastNow) clock += real - lastNow
        lastNow = real
        return clock
    }
    /** Positions every STEP_MS from `historyStart`, so readings can show the past. */
    const history: number[] = [body.position]
    let historyStart = 0
    let simulatedTo = 0
    const motor = { level: 0, sign: 0, moveFrom: 0, startedAt: 0, stopping: false, coastLeft: 0, lastSign: 0 }
    const advance = (to: number) => {
        while (simulatedTo + STEP_MS <= to) {
            simulatedTo += STEP_MS
            if (motor.level !== 0 && options.powerZoom !== false && simulatedTo >= motor.moveFrom) {
                let travel = (mechanics.rate(motor.level, body.position) * STEP_MS) / 1000
                if (motor.stopping) {
                    travel = Math.min(travel, motor.coastLeft)
                    motor.coastLeft -= travel
                }
                body.position = Math.min(lensRange.maximum, Math.max(lensRange.minimum, body.position + motor.sign * travel))
                if (motor.stopping && motor.coastLeft <= 1e-9) rest()
            } else if (motor.level !== 0 && motor.stopping && options.powerZoom === false) rest()
            history.push(body.position)
        }
        if (history.length > 20_000) {
            history.splice(0, 10_000)
            historyStart += 10_000 * STEP_MS
        }
    }
    const rest = () => {
        const detent = mechanics.detentMillimetres
        if (detent) body.position = Math.min(lensRange.maximum, Math.max(lensRange.minimum, Math.round(body.position / detent) * detent))
        motor.level = 0
        motor.stopping = false
        body.rests.push(body.position)
    }
    const positionAt = (time: number) =>
        history[Math.max(0, Math.min(history.length - 1, Math.floor((time - historyStart) / STEP_MS)))]!
    /** The reading the camera shows now: the lens `lagMs` before its newest update. */
    const reading = (time: number) => {
        let update = 0
        for (let index = 0; ; index++) {
            const next = update + mechanics.updateMs[index % mechanics.updateMs.length]!
            if (next > time) break
            update = next
        }
        const position = positionAt(update - mechanics.lagMs)
        return Math.round(Math.round(position / mechanics.stepMillimetres) * mechanics.stepMillimetres * 1000)
    }
    const command = (speed: number) => {
        const time = now()
        advance(time)
        if (speed !== 0) {
            const sign = Math.sign(speed)
            const reversing = motor.lastSign !== 0 && sign !== motor.lastSign
            const delay = mechanics.startMs + (reversing ? mechanics.reversalMs : 0)
            const moving = motor.level !== 0 && !motor.stopping && motor.sign === sign
            Object.assign(motor, { level: Math.abs(speed), sign, stopping: false, lastSign: sign })
            if (!moving) Object.assign(motor, { moveFrom: time + delay, startedAt: time })
        } else if (motor.level !== 0 && !motor.stopping && time - motor.startedAt < (mechanics.minimumPulseMs ?? 0)) {
            motor.level = 0
            body.rests.push(body.position)
        } else if (motor.level !== 0 && !motor.stopping) {
            motor.stopping = true
            // Stopped before it started, it still makes this much movement.
            motor.coastLeft = mechanics.coast(motor.level, motor.sign)
        }
    }
    const inventory = () => {
        const time = now()
        advance(time)
        const focal = properties.get(ZOOM_DISTANCE)!
        focal.value = reading(time)
        const scale = properties.get(ZOOM_SCALE)
        const digitalZoomOn = properties.get(ZOOM_SETTING)!.value !== 1
        if (scale && motor.level !== 0 && options.powerZoom === false && digitalZoomOn)
            scale.value = Math.max(1000, Number(scale.value) + motor.sign * 100)
        const records = [...properties.values()].map(property => ({
            ...property,
            current: property.value,
            range: property.range && ([property.range.minimum, property.range.maximum, property.range.step] as const),
            settableChoices: true,
        }))
        return sonyPropertyInventory(registry, records)
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        sent.push(operation.name)
        switch (operation.name) {
            case 'GetDeviceInfo':
                return { code: OK, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205, 0x9207, 0x9238]) }
            case 'SDIO_GetAllExtDevicePropInfo':
                if (body.inventoryGate) await body.inventoryGate
                if (mechanics.readMs > 0) await new Promise(resolve => setTimeout(resolve, mechanics.readMs))
                return { code: OK, data: inventory() }
            case 'SDIO_SetExtDevicePropValue': {
                const property = properties.get(parameters.DevicePropCode)!
                const raw = Number(new VariableValueCodec(registry, property.datatype).decode(data!).value.value)
                writes.push({ code: property.code, raw })
                if (property.code === OSD_IMAGE_MODE && raw === 0 && body.osdOffReply !== OK)
                    return { code: body.osdOffReply }
                property.value = raw
                return { code: OK }
            }
            case 'SDIO_ControlDevice': {
                if (parameters.sdiControlCode !== ZOOM_OPERATION) return { code: OK }
                const speed = registry.codecs.int8.decode(data!).value
                zoomCommands.push(speed)
                if (speed !== 0 && body.zoomStartThrows) throw body.zoomStartThrows
                const reply = speed === 0 ? body.stopReply : body.zoomReply
                if (reply !== OK) return { code: reply }
                command(speed)
                return { code: reply }
            }
            case 'GetObject':
                return { code: OK, data: sonyLiveViewDataset(body.liveViewImages.shift()) }
            case 'SDIO_GetOsdImage':
                return { code: OK, data: sonyOsdDataset() }
        }
        throw new Error(`Unexpected Sony operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, sent, zoomCommands, writes }
}

/** The AF and display fields of a Nikon live-view header that the focus-frame tests vary. */
interface NikonFrameFields {
    displayAreaSize: { horizontal: number; vertical: number }
    displayCenterCoords: { horizontal: number; vertical: number }
    focusingJudgementResult: number
}

/**
 * Nikon's LiveViewObject as the body sends it: a big-endian 1024-byte display-info header (wire
 * offsets from the Nikon USB reference, as NikonLiveViewDatasetCodec reads them), then the JPEG.
 */
function nikonLiveViewObject(fields: NikonFrameFields): Uint8Array {
    const headerSize = 1024
    const wire = new Uint8Array(headerSize + jpeg.length)
    const view = new DataView(wire.buffer)
    view.setUint16(0, 1) // major version
    view.setUint32(8, headerSize)
    view.setUint32(12, jpeg.length)
    view.setUint16(16, 6000) // whole size
    view.setUint16(18, 4000)
    view.setUint16(20, fields.displayAreaSize.horizontal)
    view.setUint16(22, fields.displayAreaSize.vertical)
    view.setUint16(24, fields.displayCenterCoords.horizontal)
    view.setUint16(26, fields.displayCenterCoords.vertical)
    view.setUint16(28, 640) // live-view image size
    view.setUint16(30, 424)
    view.setUint8(40, 1) // AF driving enabled
    view.setUint8(42, fields.focusingJudgementResult)
    view.setUint8(44, 1) // AF area number
    view.setUint16(48, 600) // AF frame size
    view.setUint16(50, 400)
    view.setUint16(52, 1500) // AF frame centre
    view.setUint16(54, 1000)
    wire.set(jpeg, headerSize)
    return wire
}

/**
 * Simulated Nikon body in photo mode with live view on, and the standard FocalLength property
 * (hundredths of a mm): every descriptor and the live-view object are decoded by the real codecs.
 */
function nikonBody(fields: Partial<NikonFrameFields> = {}) {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const registry = driver.registry
    const selector = registry.properties.LiveViewSelector.code
    const liveViewStatus = registry.properties.LiveViewStatus.code
    const focalLength = registry.properties.FocalLength.code
    const sent: string[] = []
    const descriptor = (code: number, datatype: number, current: number, writable: boolean) =>
        propertyDescriptor(registry, { code, datatype, current, writable }, true)
    const liveViewObject = nikonLiveViewObject({
        displayAreaSize: { horizontal: 6000, vertical: 4000 },
        displayCenterCoords: { horizontal: 3000, vertical: 2000 },
        focusingJudgementResult: 2,
        ...fields,
    })
    const send = async (operation: OperationDefinition, parameters: Record<string, number>) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo')
            return {
                code: OK,
                data: deviceInfo(camera, [selector, focalLength], [0x1001, 0x1015, 0x9201, 0x9203]),
            }
        if (operation.name === 'GetVendorCodes') return { code: OK, data: registry.codecs.uint32.encode(0) }
        if (operation.name === 'GetLiveViewImageEx')
            return { code: OK, data: new NikonLiveViewDatasetCodec(registry).decode(liveViewObject).value }
        const code = parameters.DevicePropCode
        // Photo live view (0), already on (1), and a 50 mm focal length (5000 hundredths).
        if (code === selector) return { code: OK, data: descriptor(selector, UINT8, 0, true) }
        if (code === liveViewStatus) return { code: OK, data: descriptor(liveViewStatus, UINT8, 1, true) }
        if (code === focalLength) return { code: OK, data: descriptor(focalLength, UINT32, 5000, false) }
        return { code: 0x200a }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, sent }
}

/** One EOS viewfinder segment: uint32 length and type, then the payload. */
function canonSegment(type: number, payload: Uint8Array): Uint8Array {
    const wire = new Uint8Array(8 + payload.length)
    const view = new DataView(wire.buffer)
    view.setUint32(0, wire.length, true)
    view.setUint32(4, type, true)
    wire.set(payload, 8)
    return wire
}

/**
 * Simulated Canon body: an event inventory with the live-view output already on the host, and
 * viewfinder data (JPEG segment, metadata, terminator) decoded by the real codecs.
 */
function canonBody() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const registry = driver.registry
    const sent: string[] = []
    const info = deviceInfo(camera, [], [0x1001, 0x9116, 0x9153])
    // connect() keeps the advertised operations from DeviceInfo; this fixture skips the session and its polling.
    Object.assign(driver, { supportedOperations: new Set(info.operationsSupportedRaw) })
    const send = async (operation: OperationDefinition) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo') return { code: OK, data: info }
        if (operation.name === 'CanonGetEventData') {
            // PropValueChanged (0xc189): CanonLiveViewMode HOST (2), then the terminating record.
            return { code: OK, data: canonEvents(registry, [canonValue(registry.properties.CanonLiveViewMode.code, 2)]) }
        }
        if (operation.name === 'CanonGetViewfinderData') {
            const wire = concatenate([
                canonSegment(1, jpeg),
                canonSegment(35, new Uint8Array(84)),
                canonSegment(0, new Uint8Array()),
            ])
            return { code: OK, data: new CanonLiveViewDatasetCodec(registry).decode(wire).value }
        }
        throw new Error(`Unexpected Canon operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, sent }
}

/** Standard PTP body: no live view and no zoom; FocalLength is not advertised. */
function standardBody() {
    const camera = new Camera({ transport: transport() })
    const driver = protocolSession(camera).driver
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

    it('reports both settings unsupported on Canon, Nikon and standard bodies', async () => {
        for (const { camera } of [canonBody(), nikonBody(), standardBody()]) {
            expect(await camera.getDigitalZoom().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
            expect(await camera.setLiveViewQuality('High').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        }
    })
})

/**
 * Runs a zoomTo on fake timers, advancing the clock one poll at a time until it settles, so the
 * simulated lens moves at the driver's own pace without the test waiting for it.
 */
async function zoomTo(camera: Camera, focalLengthMillimetres: number): Promise<number> {
    return onFakeClock(() => camera.zoomTo(focalLengthMillimetres))
}

/** Runs one camera call on fake timers, advancing the clock one poll at a time until it settles. */
async function onFakeClock<T>(call: () => Promise<T>): Promise<T> {
    const alreadyFake = vi.isFakeTimers()
    if (!alreadyFake) vi.useFakeTimers()
    let settled = false
    const running = call().finally(() => (settled = true))
    running.catch(() => undefined)
    try {
        while (!settled) await vi.advanceTimersByTimeAsync(20)
        return await running
    } finally {
        if (!alreadyFake) vi.useRealTimers()
    }
}

/** The bench a6700 with its E PZ 16-50mm II at 16 mm, each inventory read taking its 80 ms. */
function a6700(lens: Partial<LensMechanics> = {}, position = 16) {
    return sonyBody({
        lens: { ...A6700_PZ_16_50, readMs: 80, ...lens },
        lensName: 'E PZ 16-50mm F3.5-5.6 OSS II',
        lensRange: { minimum: 16, maximum: 50 },
        position,
    })
}

/** The zoom starts (non-zero speeds) sent from index `from` on. */
const starts = (commands: number[], from = 0) => commands.slice(from).filter(speed => speed !== 0)

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
        await onFakeClock(() => camera.stopZoom())
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
        const landed = await zoomTo(camera, 35)
        expect(Math.abs(landed - 35)).toBeLessThanOrEqual(1)
        expect(Number(body.properties.get(ZOOM_DISTANCE)!.value) / 1000).toBe(landed)
        expect(zoomCommands[0]).toBeGreaterThan(0)
        expect(zoomCommands.at(-1)).toBe(0)
        expect((await camera.getCapabilities()).lens?.focalLengthMillimetres).toBe(landed)
    })

    // 099751a's zoomTo stopped when the reading reached the target and landed 20–28 for 25 on the
    // bench a6700: the reading trails the lens about 3 mm and the lens coasts 2–4 mm more.
    it('lands within a millimetre on the bench a6700, zooming in and out (16, 25, 35, 25, 16)', async () => {
        vi.useFakeTimers()
        const { camera, body, zoomCommands } = a6700()
        let at = 16
        for (const target of [25, 35, 25, 16]) {
            const before = zoomCommands.length
            const landed = await zoomTo(camera, target)
            expect(Math.abs(landed - target), `${at} to ${target} landed at ${landed}`).toBeLessThanOrEqual(1)
            // What it returns is where the lens is, not a stale reading from while it coasted.
            expect(landed).toBe(Math.round(body.position))
            // The last movement approaches from the side it started on.
            expect(Math.sign(starts(zoomCommands, before).at(-1)!)).toBe(Math.sign(target - at))
            expect(starts(zoomCommands, before).length).toBeLessThanOrEqual(3)
            expect(zoomCommands.at(-1)).toBe(0)
            at = landed
        }
    })

    it.each([
        ['coasts 2 mm', { coast: () => 2 }],
        ['coasts 4 mm', { coast: () => 4 }],
        ['coasts 2 mm in and 3 mm out', { coast: (_level: number, sign: number) => (sign > 0 ? 2 : 3) }],
        ['trails by 0.1 s', { lagMs: 0 }],
        ['trails by 0.35 s and starts late', { lagMs: 250, startMs: 150 }],
        ['takes 0.3 s to reverse', { reversalMs: 300 }],
    ])('lands within a millimetre when the lens %s', async (_name, lens) => {
        vi.useFakeTimers()
        const { camera, body } = a6700(lens)
        for (const target of [25, 35, 25, 16, 50, 22]) {
            const landed = await zoomTo(camera, target)
            expect(Math.abs(landed - target), `landed at ${landed} for ${target}`).toBeLessThanOrEqual(1)
            expect(landed).toBe(Math.round(body.position))
        }
    })

    it('learns the coast from the first landing, so later zooms land in one movement', async () => {
        // It coasts 5 mm, twice what the bench measured: the first zoom has to come back for it.
        vi.useFakeTimers()
        const { camera, zoomCommands } = a6700({ coast: () => 5 })
        await zoomTo(camera, 30)
        expect(starts(zoomCommands).length).toBeGreaterThan(1)
        for (const target of [40, 30, 20]) {
            const before = zoomCommands.length
            expect(Math.abs((await zoomTo(camera, target)) - target)).toBeLessThanOrEqual(1)
            expect(starts(zoomCommands, before)).toHaveLength(1)
        }
    })

    // On the bench a6700 (2026-11-25), a zoomTo(25) right after a 300 ms press from 25 read the
    // ZoomDistance the lens had shown before the press (it trails 0.16–0.4 s) and returned at once at 29.
    it('waits after stopZoom until the lens has come to rest, so a zoomTo right after starts from where it is', async () => {
        vi.useFakeTimers()
        const { camera, body } = a6700({}, 25)
        await onFakeClock(() => camera.startZoom('in', { speed: 'slow' }))
        await vi.advanceTimersByTimeAsync(300)
        await onFakeClock(() => camera.stopZoom())
        // Resolved once the lens stopped: its reading is where it rests.
        expect(Number(body.properties.get(ZOOM_DISTANCE)!.value) / 1000).toBe(Math.round(body.position))
        const pressedTo = body.position
        expect(pressedTo).toBeGreaterThan(27)
        const landed = await zoomTo(camera, 25)
        expect(Math.abs(landed - 25), `from ${pressedTo} landed at ${landed}`).toBeLessThanOrEqual(1)
        expect(landed).toBe(Math.round(body.position))
    })

    it('stops a press still driving and settles before zoomTo trusts the focal length', async () => {
        // startZoom then zoomTo, no stopZoom: zoomTo stops the press itself, and the reading still trails.
        vi.useFakeTimers()
        const { camera, body } = a6700({}, 25)
        await onFakeClock(() => camera.startZoom('in', { speed: 'slow' }))
        await vi.advanceTimersByTimeAsync(300)
        const landed = await zoomTo(camera, 25)
        expect(Math.abs(landed - 25), `landed at ${landed}`).toBeLessThanOrEqual(1)
        expect(landed).toBe(Math.round(body.position))
    })

    // From 26 mm the bench a6700's zoomTo(24) stopped a 4 ms pulse (the learned coast and lag left
    // nothing to drive), the lens never moved, and zoomTo reported a lens without power zoom.
    it.each([
        ['in', 2],
        ['out', -2],
        ['in', 3],
        ['out', -3],
    ])('lands a %s move of %d mm after learning, never with a pulse too short to start the motor', async (_way, by) => {
        vi.useFakeTimers()
        const { camera, body, zoomCommands } = a6700()
        const from = await zoomTo(camera, 26)
        await zoomTo(camera, 30)
        expect(Math.abs((await zoomTo(camera, from)) - from)).toBeLessThanOrEqual(1)
        const at = Math.round(body.position)
        const before = body.rests.length
        const landed = await zoomTo(camera, at + by)
        expect(Math.abs(landed - (at + by)), `${at} to ${at + by} landed at ${landed}`).toBeLessThanOrEqual(1)
        expect(landed).toBe(Math.round(body.position))
        // Every movement moved the lens.
        const rests = [at, ...body.rests.slice(before)]
        expect(rests.slice(1).every((rest, index) => rest !== rests[index])).toBe(true)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('lands a target just inside the end of the range, approaching from the far side', async () => {
        vi.useFakeTimers()
        const { camera, body } = a6700()
        const landed = await zoomTo(camera, 18)
        expect(Math.abs(landed - 18), `landed at ${landed}`).toBeLessThanOrEqual(1)
        expect(landed).toBe(Math.round(body.position))
    })

    it('backs off a lens that goes past, then approaches again from the side it started on', async () => {
        vi.useFakeTimers()
        const { camera, zoomCommands } = a6700({ coast: () => 5 })
        expect(Math.abs((await zoomTo(camera, 25)) - 25)).toBeLessThanOrEqual(1)
        const moves = starts(zoomCommands).map(Math.sign)
        expect(moves).toContain(-1)
        expect(moves.at(-1)).toBe(1)
    })

    it('runs a long zoom at medium speed first, stopping short, then lands it slowly', async () => {
        vi.useFakeTimers()
        const { camera, zoomCommands } = a6700()
        expect(Math.abs((await zoomTo(camera, 48)) - 48)).toBeLessThanOrEqual(1)
        expect(starts(zoomCommands)[0]).toBe(4)
        expect(starts(zoomCommands).at(-1)).toBe(1)
    })

    it('reports an unknown outcome naming where the lens is when it cannot be landed within a millimetre', async () => {
        // A stepped zoom that rests only every 4 mm can never stop within a millimetre of 26.
        const { camera, body, zoomCommands } = a6700({ detentMillimetres: 4 })
        const missed = await zoomTo(camera, 26).catch(error => error)
        expect(missed).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(missed.message).toContain(`landed at ${body.position} mm`)
        expect(starts(zoomCommands).length).toBeLessThanOrEqual(6)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('stops at the end of the lens range and returns the range end, not the request', async () => {
        const { camera, zoomCommands } = sonyBody()
        expect(await zoomTo(camera, 200)).toBe(105)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('stops and reports refused when the focal length never moves with optical zoom only', async () => {
        const { camera, zoomCommands } = sonyBody({ powerZoom: false })
        expect(await zoomTo(camera, 35).catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('reports refused when Clear Image Zoom is on but Zoom Scale shows nothing moved', async () => {
        const { camera, zoomCommands } = sonyBody({ powerZoom: false, zoomSetting: 3, zoomScaleReported: true })
        // Zooming out at 1.0× digital: Zoom Scale stays at 1000, so nothing changed.
        const error = await zoomTo(camera, 10).catch(failure => failure)
        expect(error).toBeInstanceOf(CameraRefusedError)
        expect(zoomCommands.at(-1)).toBe(0)
    })

    it('reports an unknown outcome, with the read-back focal length, when digital zoom may have moved instead', async () => {
        const withoutScale = sonyBody({ powerZoom: false, zoomSetting: 3 })
        const unknown = await zoomTo(withoutScale.camera, 35).catch(failure => failure)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown.message).toMatch(/18 mm/)
        expect(withoutScale.zoomCommands.at(-1)).toBe(0)

        const withScale = sonyBody({ powerZoom: false, zoomSetting: 4, zoomScaleReported: true })
        expect(await zoomTo(withScale.camera, 35).catch(failure => failure)).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(Number(withScale.body.properties.get(ZOOM_SCALE)!.value)).toBeGreaterThan(1000)
        expect(withScale.zoomCommands.at(-1)).toBe(0)
    })

    it('sends no zoom start when stopZoom arrives while startZoom is still reading the inventory', async () => {
        const { camera, body, zoomCommands } = sonyBody()
        let release!: () => void
        body.inventoryGate = new Promise(resolve => (release = resolve))
        const starting = camera.startZoom('in', { speed: 'fast' })
        await camera.stopZoom()
        body.inventoryGate = undefined
        release()
        await expect(starting).resolves.toBeUndefined()
        expect(zoomCommands).toEqual([0])
        vi.useFakeTimers()
        await vi.advanceTimersByTimeAsync(20_000)
        expect(zoomCommands).toEqual([0])
    })

    it('leaves the lens where it is when stopZoom arrives before zoomTo sends its start', async () => {
        const { camera, body, zoomCommands } = sonyBody()
        let release!: () => void
        body.inventoryGate = new Promise(resolve => (release = resolve))
        const zooming = camera.zoomTo(50)
        await camera.stopZoom()
        body.inventoryGate = undefined
        release()
        expect(await zooming).toBe(18)
        expect(zoomCommands).toEqual([0])
        expect(Number(body.properties.get(ZOOM_DISTANCE)!.value)).toBe(18_000)
    })

    it('still starts a press that follows a stop', async () => {
        const { camera, zoomCommands } = sonyBody()
        await camera.stopZoom()
        await camera.startZoom('out', { speed: 'slow' })
        await onFakeClock(() => camera.stopZoom())
        expect(zoomCommands).toEqual([0, -1, 0])
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
    it('reports zoom unsupported, stopZoom included, and sends nothing', async () => {
        for (const { camera, sent } of [canonBody(), nikonBody(), standardBody()]) {
            const operations = (await camera.getCapabilities()).operations
            expect(operations?.startZoom).toMatchObject({ supported: false })
            expect(operations?.zoomTo).toMatchObject({ supported: false })
            const before = sent.length
            expect(await camera.startZoom('in', { speed: 'fast' }).catch(error => error)).toBeInstanceOf(
                CameraUnsupportedError
            )
            expect(await camera.zoomTo(35).catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
            expect(operations?.stopZoom).toMatchObject({ supported: false })
            expect(await camera.stopZoom().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
            expect(sent).toHaveLength(before)
        }
    })
})

describe('getLiveViewFrame', () => {
    it('returns no Sony focal frames for a truncated dataset', () => {
        expect(parseSonyFocalFrameInfo(new Uint8Array(10)).frames).toEqual([])
    })

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

    it('returns a Sony picture without the 0xFF fill after its end marker, as the FX2 pads its image size', async () => {
        // FX2 fw 1.01 (darkgrade02, 2026-11-25): size 22,016 = 43 x 512, FF D9 at 21,992, then 0xFF.
        const picture = syntheticJpeg(21_994)
        const padded = concatenate([picture, new Uint8Array(22_016 - picture.length).fill(0xff)])
        const { camera, body } = sonyBody()
        body.liveViewImages.push(padded)
        expect((await camera.getLiveViewFrame()).jpeg).toEqual(picture)
    })

    it('reads a Sony picture without its JPEG end marker once more, and reports a second as unknown', async () => {
        const cut = Uint8Array.of(0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x11, 0x11)
        const { camera, body, sent } = sonyBody()
        await camera.getCapabilities()
        body.liveViewImages.push(cut)
        expect((await camera.getLiveViewFrame()).jpeg).toEqual(jpeg)
        expect(sent.filter(name => name === 'GetObject')).toHaveLength(2)
        body.liveViewImages.push(cut, cut, jpeg)
        const outcome = await camera.getLiveViewFrame().catch(error => error)
        expect(outcome).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(outcome.message).toContain('without a JPEG end marker')
        expect(sent.filter(name => name === 'GetObject')).toHaveLength(4)
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

    it('keeps the frame when switching the overlay output off fails, and tries again an idle interval later', async () => {
        const { camera, body, writes } = sonyBody()
        await camera.getCapabilities()
        await camera.getLiveViewFrame({ overlay: true })
        body.osdOffReply = 0x2019
        const now = Date.now()
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 2_500)
        const frame = await camera.getLiveViewFrame()
        expect(frame.jpeg).toEqual(jpeg)
        expect(body.properties.get(OSD_IMAGE_MODE)!.value).toBe(1)
        // Not retried on every frame: the next attempt waits for another idle interval.
        await camera.getLiveViewFrame()
        expect(writes.filter(write => write.code === OSD_IMAGE_MODE).map(write => write.raw)).toEqual([1, 0])
        body.osdOffReply = OK
        clock.mockReturnValue(now + 5_000)
        await camera.getLiveViewFrame()
        expect(body.properties.get(OSD_IMAGE_MODE)!.value).toBe(0)
        expect(writes.filter(write => write.code === OSD_IMAGE_MODE).map(write => write.raw)).toEqual([1, 0, 0])
        await camera.getLiveViewFrame()
        expect(writes.filter(write => write.code === OSD_IMAGE_MODE)).toHaveLength(3)
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
