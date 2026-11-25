/**
 * The setControl outcome matrix every typed setting relies on, on simulated bodies whose replies are
 * encoded with the real codecs, once per write path: Sony SDIO, Canon SetPropValue, Nikon
 * SetDevicePropValueEx, standard SetDevicePropValue and the Sony SDK. Each path refuses an unoffered
 * value before sending, reports a disabled control as unsupported, reports a camera refusal and reports
 * an acknowledged write the camera never shows as unknown without resending it. The per-setting files
 * keep only their write-once rows, which pin the raw codes; the photo settings' rows are here.
 */
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { formatShutterSpeed } from '@camera/settings/values'
import { settingGetterName, settingSetterName, typedSettingIds } from '@camera/settings/typed-settings'
import { canonImageFormatFromPacked, CanonImageFormatCodec } from '@vendors/canon/datasets/canon-image-format-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { SonyWifiCamera, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { canonAllowedValues, canonEvents, canonValue } from '@tests/fixtures/canon-events'
import {
    concatenate,
    deviceInfo,
    fakeTransport as transport,
    integerCodec,
    propertyDescriptor,
    sonyPropertyInventory,
    vendorCodeList,
} from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/** One simulated property and what happens to writes of it. */
interface Body {
    current: number
    choices: number[]
    available: boolean
    /** False: writes are acknowledged but never take effect. */
    applies: boolean
    /** A PTP response code the write answers with instead of OK. */
    refuseWith?: number
    writes: number[]
}

const newBody = (current: number, choices: number[]): Body => ({ current, choices, available: true, applies: true, writes: [] })

function written(body: Body, raw: number): number {
    body.writes.push(raw)
    if (body.refuseWith) return body.refuseWith
    if (body.applies) body.current = raw
    return 0x2001
}

type Respond = (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => Promise<unknown>

/** Answer each transaction below `send`, so the driver's own response observation tells a refusal from an acknowledgement. */
function answerTransactions(driver: object, respond: Respond) {
    vi.spyOn(driver as { sendTransaction: Respond }, 'sendTransaction').mockImplementation(respond)
}

/** Simulated Sony body: SDIO inventory and SetExtDevicePropValue. */
function sonyCamera(propertyName: 'ShutterSpeed' | 'StillFileFormat', datatype: 2 | 6, body: Body) {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const code = driver.registry.properties[propertyName].code
    answerTransactions(driver, async (operation, _parameters, data) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205]) }
        if (operation.name === 'SDIO_SetExtDevicePropValue')
            return { code: written(body, Number(integerCodec(driver.registry, datatype).decode(data!).value)) }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        const record = { code, datatype, current: body.current, choices: body.choices, enabled: body.available ? 1 : 2 }
        return { code: 0x2001, data: sonyPropertyInventory(driver.registry, [record]) }
    })
    return camera
}

/** Simulated Canon body: CanonGetEventData value and allowed-value records, CanonSetPropValue. */
function canonCamera(propertyName: 'CanonShutterSpeed' | 'CanonImageFormat', body: Body) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const code = driver.registry.properties[propertyName].code
    const u32 = driver.registry.codecs.uint32
    const imageFormat = new CanonImageFormatCodec(driver.registry)
    const packed = propertyName === 'CanonImageFormat'
    // The image format is a packed RAW/JPEG entry list, not one 32-bit value.
    const records = (choices: number[]) => {
        if (!packed) return [canonValue(code, body.current), canonAllowedValues(code, choices)]
        const encode = (raw: number) => imageFormat.encode(canonImageFormatFromPacked(raw))
        const value = encode(body.current)
        const encodedChoices = choices.map(encode)
        const choiceBytes = encodedChoices.reduce((length, choice) => length + choice.length, 0)
        return [
            concatenate([u32.encode(12 + value.length), u32.encode(0xc189), u32.encode(code), value]),
            concatenate([u32.encode(20 + choiceBytes), u32.encode(0xc18a), u32.encode(code), u32.encode(3), u32.encode(choices.length), ...encodedChoices]),
        ]
    }
    answerTransactions(driver, async (operation, _parameters, data) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9110, 0x9116]) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            expect(view.getUint32(4, true)).toBe(code)
            return { code: written(body, packed ? imageFormat.decode(data!, 8).value.packed : view.getUint16(8, true)) }
        }
        expect(operation.name).toBe('CanonGetEventData')
        return { code: 0x2001, data: canonEvents(driver.registry, records(body.available ? body.choices : [])) }
    })
    return camera
}

/** Simulated Nikon body in photo mode: GetDevicePropDesc descriptors and SetDevicePropValueEx. */
function nikonCamera(propertyName: 'NikonPhotoShutterSpeed' | 'NikonRawCompression', datatype: 2 | 6, body: Body) {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const code = driver.registry.properties[propertyName].code
    const selector = driver.registry.properties.LiveViewSelector.code
    const descriptor = (propertyCode: number, propertyDatatype: number, current: number, choices: number[], writable: boolean) =>
        propertyDescriptor(driver.registry, { code: propertyCode, datatype: propertyDatatype, current, choices, writable }, true)
    answerTransactions(driver, async (operation, parameters, data) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [selector], [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]) }
        if (operation.name === 'GetVendorCodes') return { code: 0x2001, data: vendorCodeList(driver.registry, [code]) }
        if (operation.name === 'SetDevicePropValueEx')
            return { code: written(body, Number(integerCodec(driver.registry, datatype).decode(data!).value)) }
        if (parameters.DevicePropCode === selector) return { code: 0x2001, data: descriptor(selector, 2, 0, [0, 1], true) }
        if (parameters.DevicePropCode === code)
            return { code: 0x2001, data: descriptor(code, datatype, body.current, body.choices, body.available) }
        return { code: 0x200a }
    })
    return camera
}

/** Simulated standard PTP body (no vendor adapter): GetDevicePropDesc and SetDevicePropValue. */
function standardCamera(body: Body) {
    const camera = new Camera({ transport: transport() })
    const driver = protocolSession(camera).driver
    const code = driver.registry.properties.FlashMode.code
    answerTransactions(driver, async (operation, parameters, data) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [code], [0x1001, 0x1014, 0x1016]) }
        if (operation.name === 'SetDevicePropValue') return { code: written(body, driver.registry.codecs.uint16.decode(data!).value) }
        expect(parameters.DevicePropCode).toBe(code)
        const record = { code, datatype: 4, current: body.current, choices: body.choices, writable: body.available }
        return { code: 0x2001, data: propertyDescriptor(driver.registry, record) }
    })
    return camera
}

/** A Sony SDK session over a simulated bridge: white balance (264) as `properties` and `set` answer it. */
function sdkCamera(body: Body) {
    const property = () => ({
        code: 264,
        type: 3,
        value: String(body.current),
        writable: body.available,
        valueForm: 'enum',
        allowedValues: body.choices.map(String),
    })
    const bridge: SonySdkBridge = {
        request: async command => {
            if (command.cmd === 'set') {
                written(body, Number(command.value))
                return {}
            }
            expect(command.cmd).toBe('properties')
            return { properties: [property()] }
        },
        close: async () => undefined,
    }
    const camera = new SonyWifiCamera(bridge)
    Reflect.set(camera, 'connected', true)
    return camera
}

/** One setting on one simulated body: its reads and writes, and the raw value the camera receives. */
interface Setting {
    body: Body
    read: () => Promise<string>
    write: () => Promise<string>
    writeNotOffered: () => Promise<string>
    before: string
    target: string
    raw: number
}

function sonyShutterSpeed(): Setting {
    const body = newBody(0x00010032, [0x00010032, 0x0001003c, 0x00010064])
    const camera = sonyCamera('ShutterSpeed', 6, body)
    const read = () => camera.getShutterSpeed()
    return { body, read, write: () => camera.setShutterSpeed('1/60'), writeNotOffered: () => camera.setShutterSpeed('1/8000'), before: '1/50', target: '1/60', raw: 0x0001003c }
}

function canonShutterSpeed(): Setting {
    // CanonShutterSpeed codes: 0x68 1/60, 0x70 1/125, 0x78 1/250.
    const body = newBody(0x0078, [0x0068, 0x0070, 0x0078])
    const camera = canonCamera('CanonShutterSpeed', body)
    const read = () => camera.getShutterSpeed()
    return { body, read, write: () => camera.setShutterSpeed('1/60'), writeNotOffered: () => camera.setShutterSpeed('1/8000'), before: '1/250', target: '1/60', raw: 0x68 }
}

function nikonShutterSpeed(): Setting {
    // Nikon raw shutter values: 0x0001003c 1/60, 0x0001007d 1/125, 0x000100fa 1/250.
    const body = newBody(0x000100fa, [0x0001003c, 0x0001007d, 0x000100fa])
    const camera = nikonCamera('NikonPhotoShutterSpeed', 6, body)
    const read = () => camera.getShutterSpeed()
    return { body, read, write: () => camera.setShutterSpeed('1/60'), writeNotOffered: () => camera.setShutterSpeed('1/8000'), before: '1/250', target: '1/60', raw: 0x0001003c }
}

/** Sony StillFileFormat (0xD253): 1 RAW, 2 RAW+JPEG, 3 JPEG. */
function sonyPhotoFormat(): Setting {
    const body = newBody(0x03, [0x02, 0x03])
    const camera = sonyCamera('StillFileFormat', 2, body)
    const read = () => camera.getPhotoFormat()
    return { body, read, write: () => camera.setPhotoFormat('RAW+JPEG'), writeNotOffered: () => camera.setPhotoFormat('RAW'), before: 'JPEG', target: 'RAW+JPEG', raw: 0x02 }
}

/** Canon image format (0xD120): 0x03ff L, 0x0c03 RAW+L, 0x0cff RAW. */
function canonPhotoFormat(): Setting {
    const body = newBody(0x03ff, [0x03ff, 0x0c03, 0x0cff])
    const camera = canonCamera('CanonImageFormat', body)
    const read = () => camera.getPhotoFormat()
    return { body, read, write: () => camera.setPhotoFormat('RAW+L'), writeNotOffered: () => camera.setPhotoFormat('cRAW+L'), before: 'L', target: 'RAW+L', raw: 0x0c03 }
}

/** Nikon NEF compression (0xD016): 0 lossless, 3 high efficiency star, 4 high efficiency. */
function nikonRawCompression(): Setting {
    const body = newBody(3, [3, 0])
    const camera = nikonCamera('NikonRawCompression', 2, body)
    const read = () => camera.getRawCompression()
    return {
        body,
        read,
        write: () => camera.setRawCompression('Lossless'),
        writeNotOffered: () => camera.setRawCompression('High efficiency'),
        before: 'High efficiency★',
        target: 'Lossless',
        raw: 0,
    }
}

/** Standard PTP FlashMode (0x500C): 1 Auto, 2 Off, 3 Fill. */
function standardFlashMode(): Setting {
    const body = newBody(1, [1, 2])
    const camera = standardCamera(body)
    const read = () => camera.getFlashMode()
    return { body, read, write: () => camera.setFlashMode('Off'), writeNotOffered: () => camera.setFlashMode('Fill'), before: 'Auto', target: 'Off', raw: 2 }
}

/** Sony SDK white balance: 0 Auto, 17 Daylight, 18 Shade. */
function sdkWhiteBalance(): Setting {
    const body = newBody(0, [0, 17, 18])
    const camera = sdkCamera(body)
    const read = () => camera.getWhiteBalance()
    return { body, read, write: () => camera.setWhiteBalance('Shade'), writeNotOffered: () => camera.setWhiteBalance('Flash'), before: 'Auto', target: 'Shade', raw: 18 }
}

describe('a typed write on each simulated body', () => {
    it.each([
        ['Sony shutter speed', sonyShutterSpeed],
        ['Canon shutter speed', canonShutterSpeed],
        ['Nikon shutter speed', nikonShutterSpeed],
        ['Sony photo format', sonyPhotoFormat],
        ['Canon photo format', canonPhotoFormat],
        ['Nikon RAW compression', nikonRawCompression],
        ['standard PTP flash mode', standardFlashMode],
        ['Sony SDK white balance', sdkWhiteBalance],
    ] as const)('%s: writes once and resolves to the canonical value read back', async (_setting, simulate) => {
        const setting = simulate()
        expect(await setting.read()).toBe(setting.before)
        expect(await setting.write()).toBe(setting.target)
        expect(setting.body.writes).toEqual([setting.raw])
        expect(await setting.read()).toBe(setting.target)
    })

    it('accepts an exact duration object for shutter speed', async () => {
        const camera = sonyCamera('ShutterSpeed', 6, newBody(0x00010032, [0x00010032, 0x0001003c]))
        expect(await camera.setShutterSpeed({ kind: 'duration', seconds: 1 / 60 })).toBe('1/60')
    })
})

const protocolWritePaths = [
    ['Sony SDIO', sonyShutterSpeed],
    ['Canon SetPropValue', canonShutterSpeed],
    ['Nikon SetDevicePropValueEx', nikonShutterSpeed],
    ['standard SetDevicePropValue', standardFlashMode],
] as const

const writePaths = [...protocolWritePaths, ['Sony SDK', sdkWhiteBalance]] as const

describe.each(writePaths)('setControl outcomes through %s', (_path, simulate) => {
    it('refuses a value the camera does not offer, sending nothing', async () => {
        const setting = simulate()
        expect(await setting.writeNotOffered().catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(setting.body.writes).toEqual([])
    })

    it('reports an unavailable control as unsupported without writing', async () => {
        const setting = simulate()
        setting.body.available = false
        expect(await setting.write().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(setting.body.writes).toEqual([])
    })

    it('reports an acknowledged write the camera never shows as unknown, and never resends it', async () => {
        const setting = simulate()
        setting.body.applies = false
        expect(await setting.write().catch(error => error)).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(setting.body.writes).toEqual([setting.raw])
    }, 15000)
})

describe.each(protocolWritePaths)('a camera refusal through %s', (_path, simulate) => {
    it('is CameraRefusedError, sent once', async () => {
        const setting = simulate()
        setting.body.refuseWith = 0x200f
        expect(await setting.write().catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(setting.body.writes).toEqual([setting.raw])
    })
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
