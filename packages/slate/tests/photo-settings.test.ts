/**
 * The photo settings end to end on simulated bodies whose replies are encoded with the real codecs:
 * photoFormat on Sony (StillFileFormat) and Canon (its packed image format), rawCompression on
 * Nikon (NEF compression) and flashMode on a standard PTP body. Each covers a confirmed write, a
 * refused value, an unavailable control and an acknowledged write the camera never shows.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { FlashMode, PhotoFormat, PhotoSize, RawCompression } from '@camera/settings/photo'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { resolveCameraControl } from '@camera/controls'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { CanonEventDataCodec } from '@vendors/canon/datasets/canon-event-data-dataset'
import { canonImageFormatFromPacked, CanonImageFormatCodec } from '@vendors/canon/datasets/canon-image-format-dataset'
import { SDIDevicePropInfoArrayCodec } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import type { SonyImageSize } from '@vendors/sony/definitions/sony-property-definitions'
import type { CodecType } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

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
    const codec = new DeviceInfoCodec(protocolSession(camera).driver.registry)
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

type Send = (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => Promise<unknown>

interface Body {
    current: number
    choices: number[]
    applies: boolean
}

/** Sony StillFileFormat (0xD253): 1 RAW, 2 RAW+JPEG, 3 JPEG, in an SDIO inventory. */
function sonyPhotoFormat() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const codecs = driver.registry.codecs
    const property = driver.registry.properties.StillFileFormat
    const body: Body & { enabled: number } = { current: 0x03, choices: [0x02, 0x03], applies: true, enabled: 1 }
    const writes: number[] = []
    const send: Send = async (operation, _parameters, data) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205]) }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const raw = codecs.uint8.decode(data!).value
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        const wire = concatenate([
            codecs.uint32.encode(1),
            codecs.uint32.encode(0),
            codecs.uint16.encode(property.code),
            codecs.uint16.encode(2),
            codecs.uint8.encode(1),
            codecs.uint8.encode(body.enabled),
            codecs.uint8.encode(body.current),
            codecs.uint8.encode(body.current),
            codecs.uint8.encode(2),
            codecs.uint16.encode(body.choices.length),
            ...body.choices.map(choice => codecs.uint8.encode(choice)),
        ])
        return { code: 0x2001, data: new SDIDevicePropInfoArrayCodec(driver.registry).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        writes,
        read: () => camera.getPhotoFormat(),
        write: (value: PhotoFormat) => camera.setPhotoFormat(value),
        before: 'JPEG',
        target: 'RAW+JPEG',
        notOffered: 'RAW',
        makeUnavailable: () => (body.enabled = 2),
    } as const
}

/** Canon image format (0xD120): packed RAW/JPEG entries in CanonGetEventData property and choice records. */
function canonPhotoFormat() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const property = driver.registry.properties.CanonImageFormat
    const formatCodec = new CanonImageFormatCodec(driver.registry)
    const encode = (packed: number) => formatCodec.encode(canonImageFormatFromPacked(packed))
    // 0x03ff L, 0x0c03 RAW+L, 0x0cff RAW.
    const body: Body = { current: 0x03ff, choices: [0x03ff, 0x0c03, 0x0cff], applies: true }
    const writes: number[] = []
    const send: Send = async (operation, _parameters, data) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9110, 0x9116]) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            expect(view.getUint32(4, true)).toBe(property.code)
            const raw = formatCodec.decode(data!, 8).value.packed
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('CanonGetEventData')
        const u32 = driver.registry.codecs.uint32
        const value = encode(body.current)
        const choices = body.choices.map(encode)
        const choiceBytes = choices.reduce((length, choice) => length + choice.length, 0)
        const wire = concatenate([
            u32.encode(12 + value.length),
            u32.encode(0xc189),
            u32.encode(property.code),
            value,
            u32.encode(20 + choiceBytes),
            u32.encode(0xc18a),
            u32.encode(property.code),
            u32.encode(3),
            u32.encode(choices.length),
            ...choices,
            u32.encode(8),
            u32.encode(0),
        ])
        return { code: 0x2001, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        writes,
        read: () => camera.getPhotoFormat(),
        write: (value: PhotoFormat) => camera.setPhotoFormat(value),
        before: 'L',
        target: 'RAW+L',
        notOffered: 'cRAW+L',
        makeUnavailable: () => (body.choices = []),
    } as const
}

/** Nikon NEF compression (0xD016) in photo mode: 0 lossless, 3 high efficiency star, 4 high efficiency. */
function nikonRawCompression() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const code = driver.registry.properties.NikonRawCompression.code
    const selector = driver.registry.properties.LiveViewSelector.code
    const body: Body & { writable: boolean } = { current: 3, choices: [0], applies: true, writable: true }
    const writes: number[] = []
    const descriptor = (propertyCode: number, value: number, choices: number[], writable: boolean) => {
        const uint8 = driver.registry.codecs.uint8
        const wire = concatenate([
            driver.registry.codecs.uint32.encode(propertyCode),
            driver.registry.codecs.uint16.encode(2),
            Uint8Array.of(writable ? 1 : 0),
            uint8.encode(value),
            uint8.encode(value),
            Uint8Array.of(2),
            driver.registry.codecs.uint16.encode(choices.length),
            ...choices.map(choice => uint8.encode(choice)),
        ])
        return new DevicePropDescCodec(driver.registry, true).decode(wire).value
    }
    const send: Send = async (operation, parameters, data) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [selector], [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]) }
        if (operation.name === 'GetVendorCodes') {
            const u32 = driver.registry.codecs.uint32
            return { code: 0x2001, data: concatenate([u32.encode(1), u32.encode(code)]) }
        }
        if (operation.name === 'SetDevicePropValueEx') {
            const raw = driver.registry.codecs.uint8.decode(data!).value
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        if (parameters.DevicePropCode === selector) return { code: 0x2001, data: descriptor(selector, 0, [0, 1], true) }
        // The current value is advertised with the choices the body offers now.
        if (parameters.DevicePropCode === code)
            return { code: 0x2001, data: descriptor(code, body.current, [...new Set([body.current, ...body.choices])], body.writable) }
        return { code: 0x200a }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        writes,
        read: () => camera.getRawCompression(),
        write: (value: RawCompression) => camera.setRawCompression(value),
        before: 'High efficiency★',
        target: 'Lossless',
        notOffered: 'High efficiency',
        makeUnavailable: () => (body.writable = false),
    } as const
}

/** Standard PTP FlashMode (0x500C): 1 Auto, 2 Off, 3 Fill. */
function standardFlashMode() {
    const camera = new Camera({ transport: transport() })
    const driver = protocolSession(camera).driver
    const code = driver.registry.properties.FlashMode.code
    const body: Body & { writable: boolean } = { current: 1, choices: [1, 2], applies: true, writable: true }
    const writes: number[] = []
    const send: Send = async (operation, parameters, data) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [code], [0x1001, 0x1014, 0x1016]) }
        if (operation.name === 'SetDevicePropValue') {
            const raw = driver.registry.codecs.uint16.decode(data!).value
            writes.push(raw)
            if (body.applies) body.current = raw
            return { code: 0x2001 }
        }
        expect(parameters.DevicePropCode).toBe(code)
        const u16 = driver.registry.codecs.uint16
        const wire = concatenate([
            u16.encode(code),
            u16.encode(4),
            Uint8Array.of(body.writable ? 1 : 0),
            u16.encode(body.current),
            u16.encode(body.current),
            Uint8Array.of(2),
            u16.encode(body.choices.length),
            ...body.choices.map(choice => u16.encode(choice)),
        ])
        return { code: 0x2001, data: new DevicePropDescCodec(driver.registry).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return {
        camera,
        body,
        writes,
        read: () => camera.getFlashMode(),
        write: (value: FlashMode) => camera.setFlashMode(value),
        before: 'Auto',
        target: 'Off',
        notOffered: 'Fill',
        makeUnavailable: () => (body.writable = false),
    } as const
}

const bodies = [
    ['Sony photo format', sonyPhotoFormat, 'photoFormat'],
    ['Canon photo format', canonPhotoFormat, 'photoFormat'],
    ['Nikon RAW compression', nikonRawCompression, 'rawCompression'],
    ['standard PTP flash mode', standardFlashMode, 'flashMode'],
] as const

describe.each(bodies)('typed %s on a simulated body', (_setting, simulate, id) => {
    it('writes once and resolves to the canonical value read back', async () => {
        const fixture = simulate()
        expect(await fixture.read()).toBe(fixture.before)
        // Each fixture's write takes its own setting's value type.
        const write: (value: string) => Promise<string> = value => Reflect.apply(fixture.write, undefined, [value])
        expect(await write(fixture.target)).toBe(fixture.target)
        expect(fixture.writes).toHaveLength(1)
        expect(await fixture.read()).toBe(fixture.target)
    })

    it('refuses a value the camera does not offer, sending nothing', async () => {
        const fixture = simulate()
        const write: (value: string) => Promise<string> = value => Reflect.apply(fixture.write, undefined, [value])
        const refused = await write(fixture.notOffered).catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).toMatchObject({ operation: id })
        expect(fixture.writes).toHaveLength(0)
    })

    it('reports an unavailable control as unsupported without writing', async () => {
        const fixture = simulate()
        fixture.makeUnavailable()
        const write: (value: string) => Promise<string> = value => Reflect.apply(fixture.write, undefined, [value])
        const unsupported = await write(fixture.target).catch(error => error)
        expect(unsupported).toBeInstanceOf(CameraUnsupportedError)
        expect(fixture.writes).toHaveLength(0)
    })

    it('reports an acknowledged write the camera never shows as unknown, and never resends it', async () => {
        const fixture = simulate()
        fixture.body.applies = false
        const write: (value: string) => Promise<string> = value => Reflect.apply(fixture.write, undefined, [value])
        const unknown = await write(fixture.target).catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(fixture.writes).toHaveLength(1)
    }, 15000)
})

describe('photo setting names and values', () => {
    it('resolves the old ids and vendor words to the canonical ids', () => {
        expect(resolveCameraControl('stillFormat')).toBe('photoFormat')
        expect(resolveCameraControl('image quality')).toBe('photoFormat')
        expect(resolveCameraControl('imageSize')).toBe('photoSize')
        expect(resolveCameraControl('NEF compression')).toBe('rawCompression')
        expect(resolveCameraControl('flash')).toBe('flashMode')
    })

    it('types values from the codecs, never plain strings', () => {
        const camera = new Camera({ transport: transport() })
        expectTypeOf<string>().not.toExtend<Parameters<typeof camera.setPhotoFormat>[0]>()
        expectTypeOf<'RAW+JPEG'>().toExtend<PhotoFormat>()
        expectTypeOf<'cRAW+L'>().toExtend<PhotoFormat>()
        expectTypeOf<'Lossless'>().toExtend<RawCompression>()
        expectTypeOf<'Off'>().toExtend<FlashMode>()
        expectTypeOf<'6000x4000'>().toExtend<Parameters<typeof camera.setPhotoSize>[0]>()
        // Sony's size names are the codec's own, so a renamed codec value renames the setting's type.
        expectTypeOf<CodecType<(typeof SonyImageSize)['codec']>>().toExtend<PhotoSize>()
        expectTypeOf<PhotoSize>().not.toEqualTypeOf<string>()
        // Type-only: never called, so nothing reaches the transport.
        const vendorWords = () => {
            // @ts-expect-error The codecs spell RAW+JPEG without spaces.
            void camera.setPhotoFormat('RAW + JPEG')
            // @ts-expect-error Sony's old word for fill flash is not the canonical name.
            void camera.setFlashMode('Fill-flash')
        }
        void vendorWords
    })
})
