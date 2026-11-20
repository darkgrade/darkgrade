import { CanonCamera } from '@camera/canon-camera'
import { cameraControlDefinitions, resolveCameraControl } from '@camera/controls'
import { exposureSeconds, matchExposureTime, parseExposureTime } from '@camera/exposure-time'
import { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { SonyCamera } from '@camera/sony-camera'
import { PTPResponseError } from '@core/ptp-errors'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { canonMovieFormatFromWire } from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import { SDIDevicePropInfoArrayCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { SonyWifiCamera } from '@vendors/sony/sdk-camera'
import { describe, expect, it, vi } from 'vitest'

const transport = () =>
    ({
        isLittleEndian: () => true,
        isConnected: () => true,
        on: () => undefined,
    }) as unknown as TransportInterface

function info(camera: Camera, codes: number[], operations: number[] = [0x1001]): DeviceInfo {
    // Exercise the real dataset codec; avoid invented inventory field names.
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
            devicePropertiesSupported: codes,
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

function nikonFixture() {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = camera.getInstance() as NikonCamera
    driver.sessionId = 1
    const properties = new Map<
        number,
        { type: number; value: number; choices: number[]; writable: boolean; range?: number[] }
    >()
    const add = (code: number, type: number, value: number, choices: number[]) =>
        properties.set(code, { type, value, choices, writable: true })
    add(0xd1a8, 6, 0x0001003c, [0x0001003c, 0x0001007d])
    add(0xd100, 6, 0x0001007d, [0x0001003c, 0x0001007d, 0xffffffff])
    add(0x1d075, 5, 18000, [9000, 18000, 36000])
    add(0x1d074, 2, 1, [1, 2])
    add(driver.registry.properties.LiveViewSelector.code, 2, 1, [0, 1])
    add(0xd0a4, 6, 0, [0]) // Explicit idle evidence for an angle write.
    add(0x500e, 4, 1, [1, 2, 3])
    add(0xd1aa, 6, 400, [100, 400, 800])
    add(0xd0ad, 2, 0, [0, 1])
    const state = { failure: 0, wrongIdentity: false, ignoreWrite: false, disappear: false }
    const writes: number[] = []
    const calls: string[] = []
    const send = async (operation: OperationDefinition, params: Record<string, number>, data?: Uint8Array) => {
        calls.push(operation.name)
        if (operation.name === 'GetDeviceInfo')
            return {
                code: 0x2001,
                data: info(
                    camera,
                    [...properties.keys()].filter(code => code <= 0xffff),
                    [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]
                ),
            }
        if (operation.name === 'GetVendorCodes') {
            const codes = [...properties.keys()].filter(code => !state.disappear || code !== 0x1d075)
            const wire = new Uint8Array(4 + codes.length * 4),
                view = new DataView(wire.buffer)
            view.setUint32(0, codes.length, true)
            codes.forEach((code, index) => view.setUint32(4 + index * 4, code, true))
            return { code: 0x2001, data: wire }
        }
        const code = params.DevicePropCode,
            property = properties.get(code)
        if (!property) return { code: 0x200a }
        const builder = getDatatypeByCode(property.type)!.codec!
        const codec = typeof builder === 'function' ? builder(driver.registry) : builder
        if (operation.name === 'SetDevicePropValueEx') {
            writes.push(code)
            if (!state.ignoreWrite) property.value = Number(codec.decode(data!).value)
            return { code: 0x2001 }
        }
        if (state.failure && code === 0xd1a8) return { code: state.failure }
        const bytes = [
            driver.registry.codecs.uint32.encode(state.wrongIdentity ? 0x500f : code),
            driver.registry.codecs.uint16.encode(property.type),
            Uint8Array.of(property.writable ? 1 : 0),
            codec.encode(property.value),
            codec.encode(property.value),
            Uint8Array.of(property.range ? 1 : 2),
            ...(property.range
                ? property.range.map(value => codec.encode(value))
                : [
                      driver.registry.codecs.uint16.encode(property.choices.length),
                      ...property.choices.map(value => codec.encode(value)),
                  ]),
        ]
        const wire = new Uint8Array(bytes.reduce((length, part) => length + part.length, 0))
        let offset = 0
        for (const part of bytes) {
            wire.set(part, offset)
            offset += part.length
        }
        return { code: 0x2001, data: new DevicePropDescCodec(driver.registry, true).decode(wire).value }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, driver, properties, writes, calls, state }
}

describe('canonical exposure time', () => {
    it('resolves every alias to one control, with no duplicate ids', () => {
        for (const alias of ['ExposureTime', 'exposure time', 'shutterSpeed', 'shutter speed', 'shutter-angle'])
            expect(resolveCameraControl(alias)).toBe('exposureTime')
        expect(resolveCameraControl('unknown')).toBeUndefined()
        const aliases = Object.entries(cameraControlDefinitions).flatMap(([id, definition]) =>
            definition.aliases.map(alias => [id, alias])
        )
        for (const [id, alias] of aliases) expect(resolveCameraControl(alias!)).toBe(id)
    })
    it.each(['1/50', '0.02s', '0.02 seconds', { kind: 'duration', seconds: 0.02 }])(
        'matches exact duration %j',
        input => {
            expect(matchExposureTime(input as never, ['1/60', '1/50'])).toBe('1/50')
        }
    )
    it('requires explicit frame rate for cross-unit conversion, retaining fractional capture rates', () => {
        expect(() => matchExposureTime('180°', ['1/50'])).toThrow('framesPerSecond')
        expect(matchExposureTime('180°', ['1/50'], { framesPerSecond: 25 })).toBe('1/50')
        expect(matchExposureTime('1/48', ['180°'], { framesPerSecond: 24 })).toBe('180°')
        expect(exposureSeconds('180°', { framesPerSecond: 24000 / 1001 })).toBeCloseTo(1001 / 48000, 14)
        expect(matchExposureTime('1/49', ['1/50', '1/48'])).toBeUndefined()
        expect(matchExposureTime('180°', ['90°', '180°'])).toBe('180°')
    })
    it.each(['0', '-1', '1/0', '180', 'NaN', '1/50 garbage', '1/2/3', '361°'])(
        'rejects invalid or ambiguous input %s',
        input => {
            // A bare 180 is a duration, never an inferred angle.
            if (input === '180') expect(parseExposureTime(input)).toEqual({ kind: 'duration', seconds: 180 })
            else expect(() => parseExposureTime(input)).toThrow()
        }
    )
    it('preserves bulb, time and flash-sync without inventing finite seconds', () => {
        for (const name of ['BULB', 'TIME', 'FLASH_SYNC', 'Auto']) {
            expect(exposureSeconds(name)).toBeUndefined()
            expect(matchExposureTime(name, [name])).toBe(name)
        }
    })
    it.each([0, -24, NaN, Infinity, Number.MIN_VALUE, Number.MAX_VALUE])(
        'rejects unusable frame-rate context %s',
        framesPerSecond => {
            expect(() => exposureSeconds('180°', { framesPerSecond })).toThrow()
        }
    )
})

describe('Nikon capabilities from real descriptor codecs', () => {
    it('refreshes only the requested Nikon control and its mode guards before a write', async () => {
        const fixture = nikonFixture()
        const descriptor = vi.spyOn(fixture.driver, 'propertyDescriptor')
        await fixture.camera.setExposureTime('1/60')
        const readNames = descriptor.mock.calls.map(([property]) => property.name)
        expect(readNames).toContain('NikonMovieShutterSpeed')
        expect(readNames).not.toContain('NikonMovieISO')
        expect(readNames).not.toContain('ExposureProgramMode')
        expect(fixture.calls).toContain('GetDeviceInfo')
        expect(fixture.calls).toContain('GetVendorCodes')
        expect(fixture.writes).toEqual([0xd1a8])
    })
    it('uses movie/photo extensions and extended angle ids without mode-changing commands', async () => {
        const fixture = nikonFixture()
        expect((await fixture.camera.getCapabilities()).controls.exposureTime?.source.code).toBe(0xd1a8)
        fixture.properties.get(0x1d074)!.value = 2
        const angle = (await fixture.camera.getCapabilities()).controls.exposureTime!
        expect(angle.source.code).toBe(0x1d075)
        expect(angle.exposureTime).toEqual({ kind: 'angle', degrees: 180 })
        await fixture.camera.setExposureTime({ kind: 'duration', seconds: 1 / 96 }, { framesPerSecond: 24 })
        expect(fixture.properties.get(0x1d075)!.value).toBe(9000)
        expect(fixture.writes).toEqual([0x1d075])
        fixture.properties.get(fixture.driver.registry.properties.LiveViewSelector.code)!.value = 0
        expect((await fixture.camera.getCapabilities()).controls.exposureTime?.source.code).toBe(0xd100)
        expect(fixture.calls).not.toContain('ChangeCameraMode')
    })
    it('never writes absent/read-only controls or ignores a failed readback', async () => {
        const fixture = nikonFixture()
        fixture.properties.get(0x1d074)!.value = 2
        fixture.state.disappear = true
        expect((await fixture.camera.getCapabilities()).controls.exposureTime).toBeUndefined()
        await expect(fixture.camera.setExposureTime('180°')).rejects.toThrow('not writable')
        fixture.state.disappear = false
        fixture.properties.get(0x1d075)!.writable = false
        await expect(fixture.camera.setExposureTime('90°')).rejects.toThrow('not writable')
        expect(fixture.writes).toEqual([])
        fixture.properties.get(0x1d075)!.writable = true
        fixture.state.ignoreWrite = true
        await expect(fixture.camera.setExposureTime('90°')).rejects.toThrow('did not confirm')
        expect(fixture.writes).toEqual([0x1d075])
    })
    it('retains busy and wrong-descriptor failures instead of falling back or hiding them', async () => {
        const fixture = nikonFixture()
        fixture.state.failure = 0x2019
        await expect(fixture.camera.getCapabilities()).rejects.toBeInstanceOf(PTPResponseError)
        fixture.state.failure = 0
        fixture.state.wrongIdentity = true
        await expect(fixture.camera.getCapabilities()).rejects.toThrow('different property')
        expect(fixture.writes).toEqual([])
    })
    it('does not present fixed movie ISO as active or writable under Auto ISO', async () => {
        const fixture = nikonFixture()
        expect((await fixture.camera.getCapabilities()).controls.iso).toMatchObject({
            value: 'ISO 400',
            writable: true,
        })
        fixture.properties.get(0xd0ad)!.value = 1
        expect((await fixture.camera.getCapabilities()).controls.iso).toMatchObject({ value: 'Auto', writable: false })
        await expect(fixture.camera.setControl('iso', 'ISO 800')).rejects.toThrow('not writable')
        expect(fixture.writes).toEqual([])
    })
    it('requires confirmed idle for native angle changes', async () => {
        const fixture = nikonFixture()
        fixture.properties.get(0x1d074)!.value = 2
        fixture.properties.get(0xd0a4)!.value = 0x400
        await expect(fixture.camera.setExposureTime('90°')).rejects.toThrow('confirm idle')
        expect(fixture.writes).toEqual([])
    })
    it('converts an advertised angle range to degrees and rejects off-step writes', async () => {
        const fixture = nikonFixture()
        fixture.properties.get(0x1d074)!.value = 2
        fixture.properties.get(0x1d075)!.range = [9000, 36000, 9000]
        expect((await fixture.camera.getCapabilities()).controls.exposureTime?.range).toEqual({
            minimum: 90,
            maximum: 360,
            step: 90,
        })
        await fixture.camera.setExposureTime('1/96', { framesPerSecond: 24 })
        expect(fixture.properties.get(0x1d075)!.value).toBe(9000)
        await expect(fixture.camera.setExposureTime('135°')).rejects.toThrow('outside')
        expect(fixture.writes).toEqual([0x1d075])
    })
    it('refuses a photo/movie switch racing capability admission', async () => {
        const fixture = nikonFixture()
        const get = fixture.driver.get.bind(fixture.driver)
        let selectorReads = 0
        vi.spyOn(fixture.driver, 'get').mockImplementation((async (property: PropertyDefinition) => {
            const value = await get(property)
            if (property.name === 'LiveViewSelector' && ++selectorReads === 1)
                fixture.properties.get(property.code)!.value = 0
            return value
        }) as never)
        await expect(fixture.camera.setExposureTime('1/60')).rejects.toThrow('mode changed')
        expect(fixture.writes).toEqual([])
    })
    it('refuses a descriptor width incompatible with the known angle codec before writing', async () => {
        const fixture = nikonFixture()
        fixture.properties.get(0x1d074)!.value = 2
        fixture.properties.get(0x1d075)!.type = 3 // INT16 instead of the documented INT32.
        fixture.properties.get(0x1d075)!.choices = [9000, 18000]
        await expect(fixture.camera.setExposureTime('90°')).rejects.toThrow('without truncation')
        expect(fixture.writes).toEqual([])
    })
})

describe('library construction and vendor dispatch', () => {
    it('keeps partial vendor initialization caller-owned for standard diagnostic probes', async () => {
        const camera = new Camera({vendorId: 0x04a9, transport: transport()})
        const driver = camera.getInstance() as CanonCamera
        vi.spyOn(driver, 'connect').mockRejectedValue(new Error('Vendor remote mode refused'))
        const close = vi.spyOn(driver, 'disconnect').mockResolvedValue(undefined)
        vi.spyOn(driver, 'send').mockResolvedValue({code: 0x2001, data: info(camera, [], [0x1001])} as never)
        try {
            await expect(camera.connect()).rejects.toThrow('remote mode refused')
            expect(close).not.toHaveBeenCalled()
            expect((await camera.send(driver.registry.operations.GetDeviceInfo, {})).data.model).toBe('Fixture')
        } finally { await camera.disconnect() }
        expect(close).toHaveBeenCalledOnce()
    })
    it('keeps console and process exception handlers owned by the embedding application', () => {
        const log = console.log,
            handlers = process.listeners('uncaughtException')
        new Camera({ transport: transport() })
        expect(console.log).toBe(log)
        expect(process.listeners('uncaughtException')).toEqual(handlers)
    })
    it.each([
        [0x054c, SonyCamera],
        [0x04b0, NikonCamera],
        [0x04a9, CanonCamera],
    ] as const)('selects the actual USB vendor %i before opening a protocol session', async (vendorId, Driver) => {
        const camera = new Camera()
        vi.spyOn(USBTransport.prototype, 'isConnected').mockReturnValue(false)
        vi.spyOn(USBTransport.prototype, 'connect').mockResolvedValue(undefined)
        vi.spyOn(USBTransport.prototype, 'getDeviceIdentity').mockReturnValue({ vendorId, productId: 1 })
        const open = vi.spyOn(Driver.prototype, 'connect').mockResolvedValue(undefined)
        try {
            await camera.connect()
            expect(camera.getInstance()).toBeInstanceOf(Driver)
            expect(open).toHaveBeenCalledOnce()
        } finally {
            vi.restoreAllMocks()
        }
    })
    it('rejects an explicit vendor mismatch before any vendor protocol runs', async () => {
        const camera = new Camera({ vendorId: 0x054c })
        vi.spyOn(USBTransport.prototype, 'isConnected').mockReturnValue(false)
        vi.spyOn(USBTransport.prototype, 'connect').mockResolvedValue(undefined)
        vi.spyOn(USBTransport.prototype, 'getDeviceIdentity').mockReturnValue({ vendorId: 0x04b0, productId: 1 })
        const close = vi.spyOn(USBTransport.prototype, 'disconnect').mockResolvedValue(undefined)
        const open = vi.spyOn(SonyCamera.prototype, 'connect').mockResolvedValue(undefined)
        try {
            await expect(camera.connect()).rejects.toThrow('explicitly requested vendor')
            expect(open).not.toHaveBeenCalled()
            expect(close).toHaveBeenCalledOnce()
        } finally {
            vi.restoreAllMocks()
        }
    })
    it('preserves subscriptions registered before automatic driver selection', async () => {
        const camera = new Camera()
        const event = camera.getInstance().registry.events.ObjectAdded,
            handler = vi.fn()
        camera.on(event, handler)
        vi.spyOn(USBTransport.prototype, 'isConnected').mockReturnValue(false)
        vi.spyOn(USBTransport.prototype, 'connect').mockResolvedValue(undefined)
        vi.spyOn(USBTransport.prototype, 'getDeviceIdentity').mockReturnValue({ vendorId: 0x054c, productId: 1 })
        vi.spyOn(SonyCamera.prototype, 'connect').mockResolvedValue(undefined)
        const subscribe = vi.spyOn(SonyCamera.prototype, 'on')
        try {
            await camera.connect()
            expect(subscribe).toHaveBeenCalledWith(event, handler)
        } finally {
            vi.restoreAllMocks()
        }
    })
})

describe('Sony native and SDK capabilities share the same exposure contract', () => {
    it('reads actual Sony SDIO availability and refuses a display-only exposure', async () => {
        const camera = new Camera({ vendorId: 0x054c, transport: transport() })
        const driver = camera.getInstance() as SonyCamera
        const c = driver.registry.codecs
        let enabled = 1
        const send = async (operation: OperationDefinition) => {
            if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: info(camera, [], [0x1001, 0x9209]) }
            expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
            const pieces = [
                c.uint32.encode(1),
                c.uint32.encode(0),
                c.uint16.encode(driver.registry.properties.ShutterSpeed.code),
                c.uint16.encode(6),
                c.uint8.encode(1),
                c.uint8.encode(enabled),
                c.uint32.encode(0x00010032),
                c.uint32.encode(0x00010032),
                c.uint8.encode(2),
                c.uint16.encode(2),
                c.uint32.encode(0x00010032),
                c.uint32.encode(0x0001003c),
            ]
            const wire = new Uint8Array(pieces.reduce((length, piece) => length + piece.length, 0))
            let offset = 0
            for (const piece of pieces) {
                wire.set(piece, offset)
                offset += piece.length
            }
            return { code: 0x2001, data: new SDIDevicePropInfoArrayCodec(driver.registry).decode(wire).value }
        }
        vi.spyOn(driver, 'send').mockImplementation(send as never)
        expect(await camera.getExposureTime()).toEqual({ kind: 'duration', seconds: 1 / 50 })
        enabled = 2
        expect((await camera.getCapabilities()).controls.exposureTime?.writable).toBe(false)
        const write = vi.spyOn(driver, 'set')
        await expect(camera.setExposureTime('1/60')).rejects.toThrow('not writable')
        expect(write).not.toHaveBeenCalled()
    })
    it('preserves SDK angle thousandths and verifies the advertised raw write', async () => {
        const property = {
            code: 378,
            type: 3,
            value: '180000',
            writable: true,
            valueForm: 'enum',
            allowedValues: ['90000', '180000', '360000'],
        }
        const writes: { code: string; value: string }[] = []
        const camera = new SonyWifiCamera({
            request: async command => {
                if (command.cmd === 'properties')
                    return {
                        properties: [{ code: 259, type: 3, value: '4294967295', writable: false }, { ...property }],
                    }
                if (command.cmd === 'set') {
                    writes.push({ code: command.code!, value: command.value! })
                    property.value = command.value!
                }
                return { ok: true }
            },
            close: async () => {},
        })
        await camera.connectUsb('fixture')
        try {
            expect((await camera.getCapabilities()).advertisedOperations).toBeNull()
            expect(await camera.getExposureTime()).toEqual({ kind: 'angle', degrees: 180 })
            await camera.setExposureTime('1/96', { framesPerSecond: 24 })
            expect(writes).toEqual([{ code: '378', value: '90000' }])
            property.writable = false
            expect(await camera.getExposureTime()).toEqual({ kind: 'angle', degrees: 90 })
            await expect(camera.setExposureTime('180°')).rejects.toThrow('not writable')
        } finally {
            await camera.disconnect()
        }
    })
})

describe('Canon structured format capabilities', () => {
    it('maps the exact advertised record and disables ambiguous labels', async () => {
        const camera = new Camera({ vendorId: 0x04a9, transport: transport() })
        const driver = camera.getInstance() as CanonCamera
        const records = [
            [36, 0, 0, 2500, 1, 0, 1, 0, 0],
            [36, 0, 0, 2500, 12, 0, 3, 1, 0],
        ]
        const property = driver.registry.properties.CanonMovieFormat
        const send = async (operation: OperationDefinition) => {
            if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: info(camera, [], [0x1001, 0x9116]) }
            expect(operation.name).toBe('CanonGetEventData')
            const wire = new Uint8Array(48 + 20 + records.length * 36),
                view = new DataView(wire.buffer)
            view.setUint32(0, 48, true)
            view.setUint32(4, 0xc189, true)
            view.setUint32(8, property.code, true)
            records[0]!.forEach((value, index) => view.setUint32(12 + index * 4, value, true))
            view.setUint32(48, 20 + records.length * 36, true)
            view.setUint32(52, 0xc18a, true)
            view.setUint32(56, property.code, true)
            view.setUint32(60, 3, true)
            view.setUint32(64, records.length, true)
            records.flat().forEach((value, index) => view.setUint32(68 + index * 4, value, true))
            return { code: 0x2001, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
        }
        vi.spyOn(driver, 'send').mockImplementation(send as never)
        const state = (await camera.getCapabilities()).controls.movieFormat!
        expect(state.writable).toBe(true)
        const write = vi.spyOn(driver, 'setMovieFormat').mockResolvedValue(undefined)
        await camera.setControl('movieFormat', canonMovieFormatFromWire(records[1]!).label)
        expect(write).toHaveBeenCalledWith(records[1]!.join(':'))
        records.push([...records[1]!])
        records[2]![1] = 123 // Distinct wire record with the same human display.
        expect((await camera.getCapabilities()).controls.movieFormat?.writable).toBe(false)
        await expect(camera.setControl('movieFormat', state.value)).rejects.toThrow('not writable')
        expect(write).toHaveBeenCalledOnce()
    })
})
