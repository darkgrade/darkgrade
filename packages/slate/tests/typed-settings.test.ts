/**
 * The worked example every typed setting copies: shutterSpeed end to end on simulated Sony, Canon
 * and Nikon bodies whose replies are encoded with the real codecs. Each vendor covers a confirmed
 * write, a refused value, an unavailable control and an acknowledged write the camera never shows.
 */
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { CanonCamera } from '@camera/canon-camera'
import type { NikonCamera } from '@camera/nikon-camera'
import type { SonyCamera } from '@camera/sony-camera'
import type { ExposureTime } from '@camera/exposure-time'
import { formatShutterSpeed, type ShutterSpeed } from '@camera/settings/shutter-speed'
import { settingGetterName, settingSetterName, typedSettingIds } from '@camera/settings/typed-settings'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { SDIDevicePropInfoArrayCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined }) as unknown as TransportInterface

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

/** Simulated Sony body: SDIO inventory and SetExtDevicePropValue, raw 0xNNNNDDDD shutter values. */
function sonyCamera() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = camera.getInstance() as SonyCamera
    const codecs = driver.registry.codecs
    const shutter = driver.registry.properties.ShutterSpeed
    const body = { current: 0x00010032, choices: [0x00010032, 0x0001003c, 0x00010064], enabled: 1, applies: true }
    const writes: number[] = []
    const send = async (operation: OperationDefinition, _parameters: unknown, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205]) }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const raw = codecs.uint32.decode(data!).value
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        const wire = concatenate([
            codecs.uint32.encode(1),
            codecs.uint32.encode(0),
            codecs.uint16.encode(shutter.code),
            codecs.uint16.encode(6),
            codecs.uint8.encode(1),
            codecs.uint8.encode(body.enabled),
            codecs.uint32.encode(body.current),
            codecs.uint32.encode(body.current),
            codecs.uint8.encode(2),
            codecs.uint16.encode(body.choices.length),
            ...body.choices.map(choice => codecs.uint32.encode(choice)),
        ])
        return { code: 0x2001, data: new SDIDevicePropInfoArrayCodec(driver.registry).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes, makeUnavailable: () => (body.enabled = 2) }
}

/** Simulated Canon body: CanonGetEventData property/allowed-value records and CanonSetPropValue. */
function canonCamera() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = camera.getInstance() as CanonCamera
    const shutter = driver.registry.properties.CanonShutterSpeed
    // CanonShutterSpeed codes: 0x68 1/60, 0x70 1/125, 0x78 1/250.
    const body = { current: 0x0078, choices: [0x0068, 0x0070, 0x0078], applies: true }
    const writes: number[] = []
    const send = async (operation: OperationDefinition, _parameters: unknown, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9110, 0x9116]) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            expect(view.getUint32(4, true)).toBe(shutter.code)
            const raw = view.getUint16(8, true)
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('CanonGetEventData')
        const wire = new Uint8Array(16 + 20 + body.choices.length * 4 + 8)
        const view = new DataView(wire.buffer)
        view.setUint32(0, 16, true)
        view.setUint32(4, 0xc189, true)
        view.setUint32(8, shutter.code, true)
        view.setUint32(12, body.current, true)
        view.setUint32(16, 20 + body.choices.length * 4, true)
        view.setUint32(20, 0xc18a, true)
        view.setUint32(24, shutter.code, true)
        view.setUint32(28, 3, true)
        view.setUint32(32, body.choices.length, true)
        body.choices.forEach((choice, index) => view.setUint32(36 + index * 4, choice, true))
        view.setUint32(36 + body.choices.length * 4, 8, true)
        return { code: 0x2001, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes, makeUnavailable: () => (body.choices = []) }
}

/** Simulated Nikon body in photo mode: GetDevicePropDesc descriptors and SetDevicePropValueEx. */
function nikonCamera() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = camera.getInstance() as NikonCamera
    driver.sessionId = 1
    const shutterCode = 0xd100
    // Nikon raw shutter values: 0x0001003c 1/60, 0x0001007d 1/125, 0x000100fa 1/250.
    const body = {
        current: 0x000100fa,
        choices: [0x0001003c, 0x0001007d, 0x000100fa],
        writable: true,
        applies: true,
    }
    const selector = driver.registry.properties.LiveViewSelector.code
    const writes: number[] = []
    const descriptor = (code: number, type: number, value: number, choices: number[], writable: boolean) => {
        const builder = driver.registry.codecs[type === 2 ? 'uint8' : 'uint32']
        const wire = concatenate([
            driver.registry.codecs.uint32.encode(code),
            driver.registry.codecs.uint16.encode(type),
            Uint8Array.of(writable ? 1 : 0),
            builder.encode(value),
            builder.encode(value),
            Uint8Array.of(2),
            driver.registry.codecs.uint16.encode(choices.length),
            ...choices.map(choice => builder.encode(choice)),
        ])
        return new DevicePropDescCodec(driver.registry, true).decode(wire).value
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return {
                code: 0x2001,
                data: deviceInfo(camera, [selector], [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]),
            }
        if (operation.name === 'GetVendorCodes') {
            const wire = concatenate([driver.registry.codecs.uint32.encode(1), driver.registry.codecs.uint32.encode(shutterCode)])
            return { code: 0x2001, data: wire }
        }
        if (operation.name === 'SetDevicePropValueEx') {
            const raw = driver.registry.codecs.uint32.decode(data!).value
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        const code = parameters.DevicePropCode
        if (code === selector) return { code: 0x2001, data: descriptor(selector, 2, 0, [0, 1], true) }
        if (code === shutterCode)
            return { code: 0x2001, data: descriptor(shutterCode, 6, body.current, body.choices, body.writable) }
        return { code: 0x200a }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes, makeUnavailable: () => (body.writable = false) }
}

const vendors = [
    ['Sony', sonyCamera],
    ['Canon', canonCamera],
    ['Nikon', nikonCamera],
] as const

describe.each(vendors)('typed shutter speed on a simulated %s body', (_vendor, simulate) => {
    it('writes once and resolves to the canonical value read back', async () => {
        const { camera, writes } = simulate()
        expect(await camera.getShutterSpeed()).toMatch(/^1\/(50|250)$/)
        const confirmed = await camera.setShutterSpeed('1/60')
        expect(confirmed).toBe('1/60')
        expect(writes).toHaveLength(1)
        expect(await camera.getShutterSpeed()).toBe('1/60')
    })

    it('accepts an exact duration object and refuses a value the camera does not offer, sending nothing', async () => {
        const { camera, writes } = simulate()
        expect(await camera.setShutterSpeed({ kind: 'duration', seconds: 1 / 60 })).toBe('1/60')
        const refused = await camera.setShutterSpeed('1/8000').catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).toMatchObject({ operation: 'shutterSpeed' })
        expect(writes).toHaveLength(1)
    })

    it('reports an unavailable control as unsupported without writing', async () => {
        const { camera, writes, makeUnavailable } = simulate()
        makeUnavailable()
        const unsupported = await camera.setShutterSpeed('1/60').catch(error => error)
        expect(unsupported).toBeInstanceOf(CameraUnsupportedError)
        expect(writes).toHaveLength(0)
    })

    it('reports an acknowledged write the camera never shows as unknown, and never resends it', async () => {
        const { camera, body, writes } = simulate()
        body.applies = false
        const unknown = await camera.setShutterSpeed('1/60').catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(writes).toHaveLength(1)
    }, 15000)
})

describe('typed settings surface', () => {
    it('is the same on Camera and the Sony Wi-Fi session', () => {
        const accessors = (prototype: object) =>
            typedSettingIds.flatMap(id => [settingGetterName(id), settingSetterName(id)]).filter(
                name => typeof Reflect.get(prototype, name) === 'function'
            )
        expect(typedSettingIds).toContain('shutterSpeed')
        expect(accessors(Camera.prototype)).toHaveLength(typedSettingIds.length * 2)
        expect(accessors(SonyWifiCamera.prototype)).toEqual(accessors(Camera.prototype))
    })

    it('types values from the canonical spelling, not plain strings', () => {
        const camera = new Camera({ transport: transport() })
        expectTypeOf(camera.setShutterSpeed).parameter(0).toEqualTypeOf<ShutterSpeed | ExposureTime>()
        expectTypeOf(camera.getShutterSpeed).returns.resolves.toEqualTypeOf<ShutterSpeed>()
        expectTypeOf<string>().not.toExtend<Parameters<typeof camera.setShutterSpeed>[0]>()
        // @ts-expect-error A vendor's free-form word is not a shutter speed.
        void camera.setShutterSpeed('fast').catch(() => undefined)
    })

    it('spells every exposure kind canonically', () => {
        expect(formatShutterSpeed({ kind: 'duration', seconds: 1 / 250 })).toBe('1/250')
        expect(formatShutterSpeed({ kind: 'duration', seconds: 30 })).toBe('30"')
        expect(formatShutterSpeed({ kind: 'duration', seconds: 0.3 })).toBe('0.3"')
        expect(formatShutterSpeed({ kind: 'duration', seconds: 1.3 })).toBe('1.3"')
        expect(formatShutterSpeed({ kind: 'angle', degrees: 180 })).toBe('180°')
        expect(formatShutterSpeed({ kind: 'bulb' })).toBe('Bulb')
        expect(formatShutterSpeed({ kind: 'time' })).toBe('Time')
        expect(() => formatShutterSpeed(undefined, 'Unknown exposure (42)')).toThrow(CameraUnsupportedError)
    })
})
