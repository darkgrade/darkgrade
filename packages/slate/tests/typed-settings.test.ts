/**
 * The worked example every typed setting copies: shutterSpeed end to end on simulated Sony, Canon
 * and Nikon bodies whose replies are encoded with the real codecs. Each vendor covers a confirmed
 * write, a refused value, an unavailable control and an acknowledged write the camera never shows.
 */
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import type { ExposureTime } from '@camera/exposure-time'
import { formatShutterSpeed, type ShutterSpeed } from '@camera/settings/shutter-speed'
import { settingGetterName, settingSetterName, typedSettingIds } from '@camera/settings/typed-settings'
import type { OperationDefinition } from '@ptp/types/operation'
import { SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { canonAllowedValues, canonEvents, canonValue } from '@tests/fixtures/canon-events'
import { deviceInfo, fakeTransport as transport, propertyDescriptor, sonyPropertyInventory, vendorCodeList } from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/** Simulated Sony body: SDIO inventory and SetExtDevicePropValue, raw 0xNNNNDDDD shutter values. */
function sonyCamera() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
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
        const shutterRecord = { code: shutter.code, datatype: 6, current: body.current, choices: body.choices, enabled: body.enabled }
        return { code: 0x2001, data: sonyPropertyInventory(driver.registry, [shutterRecord]) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes, makeUnavailable: () => (body.enabled = 2) }
}

/** Simulated Canon body: CanonGetEventData property/allowed-value records and CanonSetPropValue. */
function canonCamera() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
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
        const records = [canonValue(shutter.code, body.current), canonAllowedValues(shutter.code, body.choices)]
        return { code: 0x2001, data: canonEvents(driver.registry, records) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes, makeUnavailable: () => (body.choices = []) }
}

/** Simulated Nikon body in photo mode: GetDevicePropDesc descriptors and SetDevicePropValueEx. */
function nikonCamera() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
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
    const descriptor = (code: number, datatype: number, current: number, choices: number[], writable: boolean) =>
        propertyDescriptor(driver.registry, { code, datatype, current, choices, writable }, true)
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return {
                code: 0x2001,
                data: deviceInfo(camera, [selector], [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]),
            }
        if (operation.name === 'GetVendorCodes') return { code: 0x2001, data: vendorCodeList(driver.registry, [shutterCode]) }
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
