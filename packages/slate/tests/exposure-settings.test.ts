/**
 * The exposure settings (aperture, ISO, exposure mode, exposure compensation, metering) on simulated
 * Sony, Canon, Nikon, generic PTP and Sony SDK bodies whose replies are built with the real codecs.
 * Each covers canonical values read from the vendor's words and a confirmed write of the camera's own
 * choice; the refused, unsupported and unknown outcomes are the matrix in typed-settings.test.ts.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import {
    canonicalExposureInput,
    formatExposureCompensation,
    type Aperture,
    type ExposureCompensation,
    type ExposureMode,
    type Iso,
    type MeteringMode,
} from '@camera/settings/values'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { LiveViewSelector } from '@vendors/nikon/definitions/nikon-property-definitions'
import type { OperationDefinition } from '@ptp/types/operation'
import { SonyWifiCamera, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { canonAllowedValues, canonEvents, canonValue } from '@tests/fixtures/canon-events'
import {
    deviceInfo,
    fakeTransport as transport,
    integerCodec,
    propertyDescriptor,
    sonyPropertyInventory,
} from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/** One simulated property: its PTP datatype, current raw value and advertised raw choices. */
interface SimulatedProperty {
    datatype: 3 | 4 | 6
    current: number
    choices: number[]
    available: boolean
    /** A range form (minimum, maximum, step) instead of an enumeration; descriptor bodies only. */
    range?: [number, number, number]
}

type Body = Record<number, SimulatedProperty>

const property = (datatype: SimulatedProperty['datatype'], current: number, choices: number[]): SimulatedProperty => ({
    datatype,
    current,
    choices,
    available: true,
})

/** The settings each scenario exercises: id, the canonical value to write, and one never offered. */
interface Scenario {
    id: 'aperture' | 'iso' | 'exposureMode' | 'exposureCompensation' | 'meteringMode'
    code: number
    initial: string
    requested: string
    /** Raw value the camera receives for `requested`. */
    written: number
    offered: string[]
    refused: string
}

interface Simulation {
    camera: Camera
    body: Body
    writes: { code: number; raw: number }[]
}

const wireCodec = (camera: Camera, datatype: number) => integerCodec(protocolSession(camera).driver.registry, datatype)

/** Simulated Sony body: SDIO inventory and SetExtDevicePropValue with each property's own width. */
function sonyCamera(body: Body): Simulation {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const writes: Simulation['writes'] = []
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205]) }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const target = body[parameters.DevicePropCode]!
            const raw = Number(wireCodec(camera, target.datatype).decode(data!).value)
            writes.push({ code: parameters.DevicePropCode, raw })
            target.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        const records = Object.entries(body).map(([code, simulated]) => ({
            ...simulated,
            code: Number(code),
            enabled: simulated.available ? 1 : 2,
        }))
        return { code: 0x2001, data: sonyPropertyInventory(driver.registry, records) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes }
}

/** Simulated Canon body: CanonGetEventData value and allowed-value records, CanonSetPropValue. */
function canonCamera(body: Body): Simulation {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const writes: Simulation['writes'] = []
    const send = async (operation: OperationDefinition, _parameters: unknown, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9110, 0x9116]) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            const code = view.getUint32(4, true)
            const raw = view.getUint16(8, true)
            writes.push({ code, raw })
            body[code]!.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('CanonGetEventData')
        const records = Object.entries(body).flatMap(([code, simulated]) => [
            canonValue(Number(code), simulated.current),
            canonAllowedValues(Number(code), simulated.available ? simulated.choices : []),
        ])
        return { code: 0x2001, data: canonEvents(driver.registry, records) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes }
}

/**
 * Simulated standard-property body: GetDevicePropDesc descriptors and SetDevicePropValue(Ex). As a
 * Nikon in photo mode (LiveViewSelector PHOTO) or as a generic PTP camera without a vendor adapter.
 */
function descriptorCamera(vendorId: number, body: Body): Simulation {
    const camera = new Camera({ vendorId, transport: transport() })
    const driver = protocolSession(camera).driver
    if (vendorId === 0x04b0) (driver as NikonCamera).sessionId = 1
    const registry = driver.registry
    const writes: Simulation['writes'] = []
    const selector = LiveViewSelector.code
    const descriptor = (
        code: number,
        datatype: number,
        current: number,
        choices: number[],
        writable: boolean,
        range?: SimulatedProperty['range']
    ) => propertyDescriptor(registry, { code, datatype, current, choices, writable, range })
    const nikon = vendorId === 0x04b0
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        const codes = Object.keys(body).map(Number)
        if (operation.name === 'GetDeviceInfo')
            return {
                code: 0x2001,
                data: deviceInfo(camera, nikon ? [selector, ...codes] : codes, [0x1001, 0x1014, 0x1015, 0x1016]),
            }
        if (operation.name === 'SetDevicePropValue' || operation.name === 'SetDevicePropValueEx') {
            const target = body[parameters.DevicePropCode]!
            const raw = Number(wireCodec(camera, target.datatype).decode(data!).value)
            writes.push({ code: parameters.DevicePropCode, raw })
            target.current = raw
            return { code: 0x2001 }
        }
        const code = parameters.DevicePropCode
        if (nikon && code === selector) return { code: 0x2001, data: descriptor(selector, 2, 0, [0, 1], true) }
        const simulated = body[code]
        if (!simulated) return { code: 0x200a }
        return {
            code: 0x2001,
            data: descriptor(
                code,
                simulated.datatype,
                simulated.current,
                simulated.choices,
                simulated.available,
                simulated.range
            ),
        }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes }
}

const sonyScenarios: Scenario[] = [
    { id: 'aperture', code: 0x5007, initial: 'f/2.8', requested: 'f/4', written: 400, offered: ['f/2.8', 'f/4', 'f/5.6'], refused: 'f/1.4' },
    { id: 'iso', code: 0xd21e, initial: 'ISO 100', requested: 'Auto', written: 0xffffff, offered: ['Auto', 'ISO 100', 'ISO 800', 'ISO 51200 (extended)', 'Multi Frame NR ISO 800'], refused: 'ISO 3200' },
    { id: 'exposureMode', code: 0x500e, initial: 'Manual', requested: 'Aperture priority', written: 0x00020003, offered: ['Manual', 'Aperture priority', 'Program'], refused: 'Shutter priority' },
    { id: 'exposureCompensation', code: 0x5010, initial: '0.0', requested: '+0.7', written: 700, offered: ['-1.0', '-0.3', '0.0', '+0.3', '+0.7'], refused: '+2.0' },
    { id: 'meteringMode', code: 0x500b, initial: 'Multi', requested: 'Spot', written: 0x8004, offered: ['Multi', 'Center-weighted', 'Spot'], refused: 'Highlight' },
]

function sonyBody(): Body {
    return {
        0x5007: property(4, 280, [280, 400, 560]),
        0xd21e: property(6, 100, [0xffffff, 100, 800, 0x10000000 | 51200, 0x01000000 | 800]),
        // Manual, Aperture Priority, Program Auto, and the movie family Movie Manual / Movie Aperture Priority.
        0x500e: property(6, 0x00000001, [0x00000001, 0x00020003, 0x00010002, 0x00078053, 0x00078051]),
        0x5010: property(3, 0, [-1000, -300, 0, 300, 700]),
        0x500b: property(4, 0x8001, [0x8001, 0x8002, 0x8004]),
    }
}

const canonScenarios: Scenario[] = [
    { id: 'aperture', code: 0xd101, initial: 'f/2.8', requested: 'f/4', written: 0x28, offered: ['f/2.8', 'f/4'], refused: 'f/1.4' },
    { id: 'iso', code: 0xd103, initial: 'ISO 100', requested: 'ISO 800', written: 0x60, offered: ['Auto', 'ISO 100', 'ISO 800'], refused: 'ISO 3200' },
    { id: 'exposureMode', code: 0xd105, initial: 'Manual', requested: 'Aperture priority', written: 2, offered: ['Program', 'Shutter priority', 'Aperture priority', 'Manual'], refused: 'Bulb' },
    { id: 'exposureCompensation', code: 0xd104, initial: '0.0', requested: '-1.0', written: 0xf8, offered: ['-1.0', '-0.3', '0.0', '+0.3', '+0.7'], refused: '+2.0' },
    { id: 'meteringMode', code: 0xd107, initial: 'Multi', requested: 'Spot', written: 1, offered: ['Spot', 'Multi', 'Center-weighted'], refused: 'Partial' },
]

function canonBody(): Body {
    return {
        0xd101: property(4, 0x20, [0x20, 0x28]),
        0xd103: property(4, 0x48, [0x00, 0x48, 0x60]),
        0xd105: property(4, 3, [0, 1, 2, 3]),
        // Eighths of a stop in a signed byte: 0xf8 −1, 0xfd −1/3, 3 +1/3, 5 +2/3.
        0xd104: property(4, 0, [0xf8, 0xfd, 0, 3, 5]),
        0xd107: property(4, 3, [1, 3, 5]),
    }
}

const standardScenarios: Scenario[] = [
    { id: 'aperture', code: 0x5007, initial: 'f/2.8', requested: 'f/4', written: 400, offered: ['f/2.8', 'f/4'], refused: 'f/1.4' },
    { id: 'iso', code: 0x500f, initial: 'ISO 100', requested: 'ISO 800', written: 800, offered: ['ISO 100', 'ISO 800'], refused: 'ISO 3200' },
    { id: 'exposureMode', code: 0x500e, initial: 'Manual', requested: 'Shutter priority', written: 4, offered: ['Manual', 'Program', 'Aperture priority', 'Shutter priority'], refused: 'Auto' },
    { id: 'exposureCompensation', code: 0x5010, initial: '0.0', requested: '+0.3', written: 333, offered: ['-0.7', '0.0', '+0.3'], refused: '+2.0' },
    { id: 'meteringMode', code: 0x500b, initial: 'Multi', requested: 'Center-weighted', written: 2, offered: ['Center-weighted', 'Multi', 'Spot'], refused: 'Average' },
]

function standardBody(): Body {
    return {
        0x5007: property(4, 280, [280, 400]),
        0x500f: property(4, 100, [100, 800]),
        0x500e: property(4, 1, [1, 2, 3, 4]),
        0x5010: property(3, 0, [-667, 0, 333]),
        0x500b: property(4, 3, [2, 3, 4]),
    }
}

const vendors = [
    ['Sony', () => sonyCamera(sonyBody()), sonyScenarios],
    ['Canon', () => canonCamera(canonBody()), canonScenarios],
    ['Nikon', () => descriptorCamera(0x04b0, standardBody()), standardScenarios],
    ['generic PTP', () => descriptorCamera(0x1234, standardBody()), standardScenarios],
] as const

const typedSetter = (camera: Camera, id: Scenario['id']) =>
    ({
        aperture: (value: string) => camera.setAperture(value as Aperture),
        iso: (value: string) => camera.setIso(value as Iso),
        exposureMode: (value: string) => camera.setExposureMode(value as ExposureMode),
        exposureCompensation: (value: string) => camera.setExposureCompensation(value as ExposureCompensation),
        meteringMode: (value: string) => camera.setMeteringMode(value as MeteringMode),
    })[id]

const typedGetter = (camera: Camera, id: Scenario['id']) =>
    ({
        aperture: () => camera.getAperture(),
        iso: () => camera.getIso(),
        exposureMode: () => camera.getExposureMode(),
        exposureCompensation: () => camera.getExposureCompensation(),
        meteringMode: () => camera.getMeteringMode(),
    })[id]

describe.each(vendors)('exposure settings on a simulated %s body', (_vendor, simulate, scenarios) => {
    it.each(scenarios)('$id reads canonical names and confirms one write of the camera choice', async scenario => {
        const { camera, writes } = simulate()
        const control = (await camera.getCapabilities()).controls[scenario.id]
        expect(control).toMatchObject({ value: scenario.initial, writable: true })
        expect(control?.allowedValues).toEqual(scenario.offered)
        expect(await typedGetter(camera, scenario.id)()).toBe(scenario.initial)
        expect(await typedSetter(camera, scenario.id)(scenario.requested)).toBe(scenario.requested)
        expect(writes).toEqual([{ code: scenario.code, raw: scenario.written }])
        expect(await typedGetter(camera, scenario.id)()).toBe(scenario.requested)
    })
})

describe('exposure vocabulary', () => {
    it('offers only the current Sony family and maps Movie Manual to Manual', async () => {
        const body = sonyBody()
        body[0x500e]!.current = 0x00078053
        const { camera, writes } = sonyCamera(body)
        const mode = (await camera.getCapabilities()).controls.exposureMode
        expect(mode).toMatchObject({ value: 'Manual', allowedValues: ['Manual', 'Aperture priority'] })
        expect((await camera.getCapabilities()).controls.photoVideoMode?.value).toBe('video')
        expect(await camera.setExposureMode('A')).toBe('Aperture priority')
        expect(writes).toEqual([{ code: 0x500e, raw: 0x00078051 }])
    })

    it('accepts the mode-dial letters and Canon Av/Tv as exact spellings', () => {
        expect(canonicalExposureInput('exposureMode', 'M')).toBe('Manual')
        expect(canonicalExposureInput('exposureMode', 'Av')).toBe('Aperture priority')
        expect(canonicalExposureInput('exposureMode', 'Tv')).toBe('Shutter priority')
        expect(canonicalExposureInput('exposureMode', 'manual')).toBe('Manual')
        expect(canonicalExposureInput('iso', '800')).toBe('ISO 800')
        expect(canonicalExposureInput('iso', 'ISO AUTO')).toBe('Auto')
        expect(canonicalExposureInput('aperture', 'F4.0')).toBe('f/4')
        expect(canonicalExposureInput('exposureCompensation', '+1')).toBe('+1.0')
        // Never a nearby value: a third of a stop is not rounded to the camera's one-decimal name.
        expect(canonicalExposureInput('exposureCompensation', '+0.33')).toBe('+0.33')
        expect(formatExposureCompensation(-1 / 3)).toBe('-0.3')
        expect(formatExposureCompensation(0)).toBe('0.0')
    })

    it('refuses an aperture that only rounds to an offered f-number, sending nothing', async () => {
        expect(canonicalExposureInput('aperture', 'f/2.83')).toBe('f/2.83')
        expect(canonicalExposureInput('aperture', 'F3.45')).toBe('f/3.45')
        expect(canonicalExposureInput('aperture', 'f/2.833')).toBe('f/2.833')
        expect(canonicalExposureInput('aperture', 'F2.80')).toBe('f/2.8')
        const body = standardBody()
        body[0x5007] = property(4, 280, [280, 350])
        const { camera, writes } = descriptorCamera(0x1234, body)
        for (const requested of ['f/2.83', 'f/3.45', 'f/5.65'] as const)
            await expect(camera.setAperture(requested)).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toEqual([])
        expect(await camera.setAperture('f/3.5')).toBe('f/3.5')
        expect(writes).toEqual([{ code: 0x5007, raw: 350 }])
    })

    it('reads a standard FNumber of 95 hundredths as f/0.95, not f/0.9', async () => {
        const body = sonyBody()
        body[0x5007] = property(4, 95, [95, 283, 400])
        const { camera, writes } = sonyCamera(body)
        expect((await camera.getCapabilities()).controls.aperture).toMatchObject({
            value: 'f/0.95',
            allowedValues: ['f/0.95', 'f/2.83', 'f/4'],
        })
        await expect(camera.setAperture('f/2.8')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toEqual([])
    })

    it('reads a Canon implicit auto aperture as Auto and never writes it', async () => {
        const body = canonBody()
        // 0x0000 implicit auto (Tv/P); 0xffff is the codec's other `auto` code.
        body[0xd101] = property(4, 0x0000, [0xffff, 0x20, 0x28])
        const { camera, writes } = canonCamera(body)
        const aperture = (await camera.getCapabilities()).controls.aperture
        expect(aperture).toMatchObject({ value: 'Auto', allowedValues: ['f/2.8', 'f/4'], writable: true })
        expect(aperture?.unrecognized).toBeUndefined()
        expect(await camera.getAperture()).toBe('Auto')
        await expect(camera.setAperture('Auto')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toEqual([])
        expect(await camera.setAperture('f/4')).toBe('f/4')
        expect(writes).toEqual([{ code: 0xd101, raw: 0x28 }])
    })

    it.each([
        ['Nikon in photo mode', 0x04b0],
        ['generic PTP', 0x1234],
    ] as const)('admits exact ISO and f-numbers on a ranged %s property, unrounded', async (_body, vendorId) => {
        const body = standardBody()
        body[0x500f] = { ...property(4, 100, []), range: [100, 6400, 100] }
        body[0x5007] = { ...property(4, 280, []), range: [280, 2200, 10] }
        const { camera, writes } = descriptorCamera(vendorId, body)
        const { controls } = await camera.getCapabilities()
        expect(controls.iso).toMatchObject({ value: 'ISO 100', writable: true, range: { minimum: 100, maximum: 6400, step: 100 } })
        expect(controls.aperture).toMatchObject({ value: 'f/2.8', writable: true, range: { minimum: 2.8, maximum: 22, step: 0.1 } })
        await expect(camera.setIso('ISO 850')).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.setAperture('f/4.05')).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.setAperture('f/32')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toEqual([])
        expect(await camera.setIso('ISO 800')).toBe('ISO 800')
        expect(await camera.setAperture('f/4')).toBe('f/4')
        expect(writes).toEqual([
            { code: 0x500f, raw: 800 },
            { code: 0x5007, raw: 400 },
        ])
    })

    it('keeps a ranged canonical control with no exact wire scale read-only', async () => {
        const body = standardBody()
        body[0x500b] = { ...property(4, 3, []), range: [1, 4, 1] }
        const { camera, writes } = descriptorCamera(0x1234, body)
        const metering = (await camera.getCapabilities()).controls.meteringMode
        expect(metering).toMatchObject({ value: 'Multi', writable: false })
        expect(metering?.range).toBeUndefined()
        await expect(camera.setMeteringMode('Spot')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(writes).toEqual([])
    })
})

describe('exposure settings on the Sony SDK session', () => {
    function sdkCamera() {
        const properties = [
            { code: 256, type: 2, value: '280', writable: true, allowedValues: ['280', '400'] },
            { code: 260, type: 3, value: '100', writable: true, allowedValues: ['16777215', '100', '800'] },
            { code: 261, type: 3, value: '32851', writable: true, allowedValues: ['1', '3', '32851', '32849'] },
            { code: 257, type: 2, value: '0', writable: true, allowedValues: ['-1000', '0', '700'] },
            { code: 266, type: 2, value: '5', writable: true, allowedValues: ['5', '6', '8'] },
        ]
        const writes: { code: string; value: string }[] = []
        const bridge: SonySdkBridge = {
            request: async request => {
                if (request.cmd === 'properties') return { properties: properties.map(entry => ({ ...entry })) }
                if (request.cmd === 'set') {
                    writes.push({ code: request.code!, value: request.value! })
                    const target = properties.find(entry => entry.code === Number(request.code))
                    if (target) target.value = request.value!
                }
                return { ok: true }
            },
            close: async () => {},
        }
        return { camera: new SonyWifiCamera(bridge), writes }
    }

    it('reads canonical names and writes the SDK value behind each', async () => {
        const { camera, writes } = sdkCamera()
        await camera.connectUsb('unit-test')
        const { controls } = await camera.getCapabilities()
        expect(controls.aperture).toMatchObject({ value: 'f/2.8', allowedValues: ['f/2.8', 'f/4'] })
        expect(controls.iso).toMatchObject({ value: 'ISO 100', allowedValues: ['Auto', 'ISO 100', 'ISO 800'] })
        expect(controls.exposureMode).toMatchObject({ value: 'Manual', allowedValues: ['Manual', 'Aperture priority'] })
        expect(controls.exposureCompensation).toMatchObject({ value: '0.0', allowedValues: ['-1.0', '0.0', '+0.7'] })
        expect(controls.meteringMode).toMatchObject({ value: 'Multi', allowedValues: ['Multi', 'Center-weighted', 'Spot'] })
        expect(await camera.setIso('ISO 800')).toBe('ISO 800')
        expect(await camera.setExposureMode('Av')).toBe('Aperture priority')
        expect(await camera.setExposureCompensation('+0.7')).toBe('+0.7')
        expect(await camera.setMeteringMode('Spot')).toBe('Spot')
        expect(writes.filter(write => ['256', '257', '260', '261', '266'].includes(write.code))).toEqual([
            { code: '260', value: '800' },
            { code: '261', value: '32849' },
            { code: '257', value: '700' },
            { code: '266', value: '8' },
        ])
        await expect(camera.setAperture('f/1.4')).rejects.toBeInstanceOf(CameraRefusedError)
    })
})
