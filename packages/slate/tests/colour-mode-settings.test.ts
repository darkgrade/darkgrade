/**
 * The colour and mode settings (whiteBalance, colorTemperature, pictureStyle, pictureProfile,
 * photoVideoMode, driveMode) on simulated Sony, Canon, Nikon and standard PTP bodies whose replies
 * are encoded with the real codecs. Each covers canonical names and a confirmed write; the generic
 * refused, unsupported and unknown outcomes are the matrix in typed-settings.test.ts, and only the
 * photo/video switches, which have their own write paths, keep theirs here.
 */
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import type { OperationDefinition } from '@ptp/types/operation'
import { SonyWifiCamera, type SonySdkBridge, type SonySdkProperty } from '@vendors/sony/sdk-camera'
import { sonyCounterpartExposureProgram, sonyExposureProgramKind } from '@vendors/sony/exposure-program'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { canonAllowedValues, canonEvents, canonValue } from '@tests/fixtures/canon-events'
import { deviceInfo, fakeTransport as transport, propertyDescriptor, sonyPropertyInventory, vendorCodeList } from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/**
 * Answer each transaction below `send`, so the driver's own `send` (and the response observation a
 * setting write uses to tell a refusal from an acknowledged change) runs as it does on a body.
 */
function answerTransactions(driver: object, answer: (...request: never[]) => Promise<unknown>) {
    vi.spyOn(driver as { sendTransaction: typeof answer }, 'sendTransaction').mockImplementation(answer)
}

function decodeUnsigned(data: Uint8Array): number {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    return data.length >= 4 ? view.getUint32(0, true) : data.length === 2 ? view.getUint16(0, true) : view.getUint8(0)
}

interface SimulatedProperty {
    datatype: 2 | 4 | 6
    current: number
    choices?: number[]
    range?: [minimum: number, maximum: number, step: number]
    enabled?: boolean
    writable?: boolean
}

/** One simulated body's properties and what happens to writes. */
interface Body {
    properties: Map<number, SimulatedProperty>
    /** False: writes are acknowledged but never take effect. */
    applies: boolean
    /** A PTP response code every property write answers with instead of OK. */
    refuseWith?: number
    writes: { code: number; value: number }[]
}

function newBody(properties: Record<number, SimulatedProperty>): Body {
    return { properties: new Map(Object.entries(properties).map(([code, state]) => [Number(code), state])), applies: true, writes: [] }
}

function record(body: Body, code: number, value: number): number {
    body.writes.push({ code, value })
    if (body.refuseWith) return body.refuseWith
    const property = body.properties.get(code)
    if (property && body.applies) property.current = value
    return 0x2001
}

// ---------------------------------------------------------------- Sony

const sonyCodes = {
    whiteBalance: 0x5005,
    colorTemperature: 0xd20f,
    creativeLook: 0xd0fa,
    pictureProfile: 0xd23f,
    driveMode: 0x5013,
    exposureProgram: 0x500e,
    movieRecordingState: 0xd21d,
}

/** Simulated Sony body: SDIO_GetAllExtDevicePropInfo inventory and SDIO_SetExtDevicePropValue. */
function sonyCamera() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const body = newBody({
        [sonyCodes.whiteBalance]: { datatype: 4, current: 0x0002, choices: [0x0002, 0x0004, 0x8011, 0x8023] },
        [sonyCodes.colorTemperature]: { datatype: 4, current: 5500, range: [2500, 9900, 100] },
        [sonyCodes.creativeLook]: { datatype: 4, current: 0x0001, choices: [0x0001, 0x0002, 0x0009, 0x0101] },
        [sonyCodes.pictureProfile]: { datatype: 2, current: 0x00, choices: [0x00, 0x01, 0x08] },
        [sonyCodes.driveMode]: { datatype: 6, current: 0x00000001, choices: [0x00000001, 0x00010002, 0x00038004] },
        [sonyCodes.exposureProgram]: {
            datatype: 6,
            current: 0x00000001,
            choices: [0x00000001, 0x00020003, 0x00078053, 0x00078051, 0x00078090],
        },
        [sonyCodes.movieRecordingState]: { datatype: 2, current: 0, writable: false },
    })
    const inventory = () =>
        sonyPropertyInventory(
            driver.registry,
            [...body.properties].map(([code, property]) => ({ ...property, code, enabled: property.enabled === false ? 2 : 1, settableChoices: true }))
        )
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205]) }
        if (operation.name === 'SDIO_SetExtDevicePropValue')
            return { code: record(body, parameters.DevicePropCode!, decodeUnsigned(data!)) }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        return { code: 0x2001, data: inventory() }
    }
    answerTransactions(driver, send as never)
    return { camera, body }
}

// ---------------------------------------------------------------- Canon

const canonCodes = {
    whiteBalance: 0xd109,
    colorTemperature: 0xd10a,
    pictureStyle: 0xd110,
    driveMode: 0xd106,
    fixedMovie: 0xd1c2,
    recordingDestination: 0xd1b8,
}

/** Simulated Canon EOS body: CanonGetEventData records, CanonSetPropValue and the movie select switch. */
function canonCamera() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const operations = driver.registry.operations
    // A connected session's DeviceInfo inventory; the fixture does not run the connect sequence.
    Reflect.set(
        driver,
        'supportedOperations',
        new Set([0x1001, operations.CanonMovieSelectSwitchOn.code, operations.CanonMovieSelectSwitchOff.code])
    )
    const body = Object.assign(
        newBody({
            [canonCodes.whiteBalance]: { datatype: 2, current: 0, choices: [0, 1, 7, 8, 9] },
            [canonCodes.colorTemperature]: { datatype: 6, current: 5200, choices: [5000, 5200, 5600] },
            [canonCodes.pictureStyle]: { datatype: 4, current: 0x81, choices: [0x81, 0x82, 0x86] },
            [canonCodes.driveMode]: { datatype: 4, current: 0x00, choices: [0x00, 0x01, 0x10] },
            [canonCodes.fixedMovie]: { datatype: 6, current: 0 },
            [canonCodes.recordingDestination]: { datatype: 4, current: 0 },
        }),
        { switches: [] as string[], leverAtMovie: false }
    )
    const send = async (operation: OperationDefinition, _parameters: unknown, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9110, 0x9116]) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            return { code: record(body, view.getUint32(4, true), view.getUint32(8, true)) }
        }
        if (operation === operations.CanonMovieSelectSwitchOn || operation === operations.CanonMovieSelectSwitchOff) {
            const movie = operation === operations.CanonMovieSelectSwitchOn
            body.switches.push(movie ? 'video' : 'photo')
            if (body.refuseWith) return { code: body.refuseWith }
            if (!body.leverAtMovie) body.properties.get(canonCodes.fixedMovie)!.current = movie ? 1 : 0
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('CanonGetEventData')
        const records = [...body.properties].flatMap(([code, property]) => [
            canonValue(code, property.current),
            ...(property.choices ? [canonAllowedValues(code, property.choices)] : []),
        ])
        return { code: 0x2001, data: canonEvents(driver.registry, records) }
    }
    answerTransactions(driver, send as never)
    return { camera, body }
}

// ---------------------------------------------------------------- Nikon

const nikonCodes = {
    selector: 0xd1a6,
    whiteBalance: 0x5005,
    movieWhiteBalance: 0xd23a,
    kelvin: 0xd01e,
    pictureControl: 0xd200,
    moviePictureControl: 0xd237,
    driveMode: 0x5013,
    recordingProhibition: 0xd0a4,
    liveViewStatus: 0xd1b8,
}

type NikonBody = Body & { deviceReadyAfterSelector: number | undefined }

/** Simulated Nikon Z body: GetDevicePropDescEx descriptors, SetDevicePropValueEx and DeviceReady. */
function nikonCamera(mode: 'photo' | 'video' = 'photo') {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const body = newBody({
        [nikonCodes.selector]: { datatype: 2, current: mode === 'video' ? 1 : 0, choices: [0, 1] },
        [nikonCodes.whiteBalance]: { datatype: 4, current: 0x0004, choices: [0x0002, 0x0004, 0x8011, 0x8013] },
        [nikonCodes.movieWhiteBalance]: { datatype: 4, current: 0x8015, choices: [0x0002, 0x0004, 0x8015] },
        [nikonCodes.kelvin]: { datatype: 4, current: 5000, range: [2500, 10000, 10] },
        [nikonCodes.pictureControl]: { datatype: 4, current: 1, choices: [1, 4, 101] },
        [nikonCodes.moviePictureControl]: { datatype: 4, current: 100, choices: [1, 100] },
        [nikonCodes.driveMode]: { datatype: 4, current: 0x0001, choices: [0x0001, 0x0002, 0x8011] },
        [nikonCodes.recordingProhibition]: { datatype: 6, current: 0, writable: false },
        [nikonCodes.liveViewStatus]: { datatype: 2, current: 0, choices: [0, 1], writable: false },
    })
    const session = Object.assign(body, {
        /** Camera-mode and live-view commands, in order. */
        commands: [] as string[],
        /** A response code for the first DeviceReady after a selector write, instead of OK. */
        deviceReadyAfterSelector: undefined as number | undefined,
    })
    const standardCodes = [nikonCodes.whiteBalance, nikonCodes.driveMode, nikonCodes.selector]
    const vendorCodes = [...body.properties.keys()].filter(code => !standardCodes.includes(code))
    const descriptor = (code: number) => propertyDescriptor(driver.registry, { ...body.properties.get(code)!, code }, true)
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, standardCodes, [0x1001, 0x9439, 0x943a, 0x943b, 0x943c]) }
        if (operation.name === 'GetVendorCodes') return { code: 0x2001, data: vendorCodeList(driver.registry, vendorCodes) }
        if (operation.name === 'DeviceReady') {
            const failure = session.deviceReadyAfterSelector
            if (failure !== undefined && writesTo(body, nikonCodes.selector).length > 0) {
                session.deviceReadyAfterSelector = undefined
                return { code: failure }
            }
            return { code: 0x2001 }
        }
        if (operation.name === 'ChangeCameraMode') {
            session.commands.push(`ChangeCameraMode ${String(parameters.Mode)}`)
            return { code: 0x2001 }
        }
        if (operation.name === 'EndLiveView' || operation.name === 'StartLiveView') {
            session.commands.push(operation.name)
            body.properties.get(nikonCodes.liveViewStatus)!.current = operation.name === 'StartLiveView' ? 1 : 0
            return { code: 0x2001 }
        }
        if (operation.name === 'SetDevicePropValueEx') return { code: record(body, parameters.DevicePropCode!, decodeUnsigned(data!)) }
        const code = parameters.DevicePropCode!
        if (body.properties.has(code)) return { code: 0x2001, data: descriptor(code) }
        return { code: 0x200a }
    }
    answerTransactions(driver, send as never)
    return { camera, body: session }
}

// ---------------------------------------------------------------- Standard PTP

/** Simulated standard PTP body (no vendor adapter): GetDevicePropDesc and SetDevicePropValue. */
function standardCamera() {
    const camera = new Camera({ vendorId: 0x1d6b, transport: transport() })
    const driver = protocolSession(camera).driver
    const body = newBody({
        0x5005: { datatype: 4, current: 0x0002, choices: [0x0002, 0x0004, 0x0006, 0x8001] },
        0x5013: { datatype: 4, current: 0x0001, choices: [0x0001, 0x0002] },
    })
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [...body.properties.keys()], [0x1001, 0x1014, 0x1016]) }
        if (operation.name === 'SetDevicePropValue') return { code: record(body, parameters.DevicePropCode!, decodeUnsigned(data!)) }
        expect(operation.name).toBe('GetDevicePropDesc')
        const property = body.properties.get(parameters.DevicePropCode!)!
        return { code: 0x2001, data: propertyDescriptor(driver.registry, { ...property, code: parameters.DevicePropCode!, writable: true }) }
    }
    answerTransactions(driver, send as never)
    return { camera, body }
}

const writesTo = (body: Body, code: number) => body.writes.filter(write => write.code === code)

describe('white balance in canonical names on every vendor', () => {
    it('Sony: Custom presets are named as Sony documents them, and a write resolves to the readback', async () => {
        const { camera, body } = sonyCamera()
        expect(await camera.getWhiteBalance()).toBe('Auto')
        expect((await camera.getCapabilities()).controls.whiteBalance?.allowedValues).toEqual(['Auto', 'Daylight', 'Shade', 'Custom'])
        expect(await camera.setWhiteBalance('Shade')).toBe('Shade')
        expect(writesTo(body, sonyCodes.whiteBalance)).toEqual([{ code: sonyCodes.whiteBalance, value: 0x8011 }])
    })

    it('Canon: kebab-case codes read as canonical names and value 7 is unrecognized, never offered', async () => {
        const { camera, body } = canonCamera()
        const control = (await camera.getCapabilities()).controls.whiteBalance
        expect(control?.allowedValues).toEqual(['Auto', 'Daylight', 'Shade', 'Color Temperature'])
        expect(control?.unrecognized?.choices).toEqual(['0x7'])
        expect(await camera.setWhiteBalance('Daylight')).toBe('Daylight')
        expect(writesTo(body, canonCodes.whiteBalance)).toEqual([{ code: canonCodes.whiteBalance, value: 1 }])
        body.properties.get(canonCodes.whiteBalance)!.current = 7
        const unnamed = await camera.getWhiteBalance().catch(error => error)
        expect(unnamed).toBeInstanceOf(CameraUnsupportedError)
        expect(String(unnamed.message)).toContain('Unrecognized (0x7)')
        expect(await camera.setWhiteBalance('Auto').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
    })

    it("Nikon photo: Nikon's Sunny is Daylight and Preset manual is Custom", async () => {
        const { camera, body } = nikonCamera()
        expect(await camera.getWhiteBalance()).toBe('Daylight')
        expect((await camera.getCapabilities()).controls.whiteBalance?.allowedValues).toEqual(['Auto', 'Daylight', 'Shade', 'Custom'])
        expect(await camera.setWhiteBalance('Custom')).toBe('Custom')
        expect(writesTo(body, nikonCodes.whiteBalance)).toEqual([{ code: nikonCodes.whiteBalance, value: 0x8013 }])
    })

    it('Nikon video: movie white balance reads its own property, including Same as photo', async () => {
        const { camera } = nikonCamera('video')
        const control = (await camera.getCapabilities()).controls.whiteBalance
        expect(control?.source.name).toBe('NikonMovieWhiteBalance')
        expect(control?.value).toBe('Same as photo')
        expect(control?.allowedValues).toEqual(['Auto', 'Daylight', 'Same as photo'])
    })

    it('standard PTP: ISO 15740 values are named, vendor values are unrecognized', async () => {
        const { camera, body } = standardCamera()
        const control = (await camera.getCapabilities()).controls.whiteBalance
        expect(control?.allowedValues).toEqual(['Auto', 'Daylight', 'Tungsten'])
        expect(control?.unrecognized?.choices).toEqual(['0x8001'])
        expect(await camera.setWhiteBalance('Tungsten')).toBe('Tungsten')
        expect(writesTo(body, 0x5005)).toEqual([{ code: 0x5005, value: 0x0006 }])
    })
})

describe('colour temperature in kelvin', () => {
    it.each([
        ['Sony', sonyCamera, 5600],
        ['Canon', canonCamera, 5600],
        ['Nikon', () => nikonCamera(), 5600],
    ] as const)('%s: reads and writes a number', async (_vendor, simulate, kelvin) => {
        const { camera } = simulate()
        expect(typeof (await camera.getColorTemperature())).toBe('number')
        expect(await camera.setColorTemperature(kelvin)).toBe(kelvin)
        expect(await camera.setColorTemperature(123456).catch(error => error)).toBeInstanceOf(CameraRefusedError)
    })

    it('says colour temperature does not apply when the camera reports it disabled (a Sony in Daylight)', async () => {
        const { camera, body } = sonyCamera()
        Object.assign(body.properties.get(sonyCodes.colorTemperature)!, { current: 0, enabled: false })
        const outcome = await camera.getColorTemperature().catch(error => error)
        expect(outcome).toBeInstanceOf(CameraUnsupportedError)
        expect(outcome.message).toContain('does not apply with the current white balance')
        // An FX2 in Auto reports it enabled at 0 K: getCapabilities and the getter agree it does not apply.
        Object.assign(body.properties.get(sonyCodes.colorTemperature)!, { current: 0, enabled: true })
        expect((await camera.getCapabilities()).controls.colorTemperature).toMatchObject({ value: '0', enabled: false, writable: false })
        expect((await camera.getColorTemperature().catch(error => error)).message).toContain('does not apply')
    })

    it('says a Sony drive mode 0x0 with nothing to choose (movie mode) does not apply', async () => {
        const { camera, body } = sonyCamera()
        Object.assign(body.properties.get(sonyCodes.driveMode)!, { current: 0, choices: [] })
        expect((await camera.getCapabilities()).controls.driveMode).toMatchObject({ enabled: false, writable: false })
        const outcome = await camera.getDriveMode().catch(error => error)
        expect(outcome).toBeInstanceOf(CameraUnsupportedError)
        expect(outcome.message).toContain("does not apply in the camera's current mode")
    })
})

describe('look (picture style) and picture profile', () => {
    it('Sony: Creative Look and Picture Profile', async () => {
        const { camera, body } = sonyCamera()
        expect(await camera.getPictureStyle()).toBe('Standard')
        expect((await camera.getCapabilities()).controls.pictureStyle?.allowedValues).toEqual([
            'Standard',
            'Portrait',
            'Monochrome',
            'Custom look 1',
        ])
        expect(await camera.setPictureStyle('Monochrome')).toBe('Monochrome')
        expect(await camera.getPictureProfile()).toBe('Off')
        expect(await camera.setPictureProfile('PP8')).toBe('PP8')
        expect(writesTo(body, sonyCodes.pictureProfile)).toEqual([{ code: sonyCodes.pictureProfile, value: 0x08 }])
    })

    it('Canon: Picture Style', async () => {
        const { camera, body } = canonCamera()
        expect(await camera.getPictureStyle()).toBe('Standard')
        expect(await camera.setPictureStyle('Portrait')).toBe('Portrait')
        expect(writesTo(body, canonCodes.pictureStyle)).toEqual([{ code: canonCodes.pictureStyle, value: 0x82 }])
        expect(await camera.getPictureProfile().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
    })

    it('Nikon: Picture Control in photo mode and its own movie Picture Control in video mode', async () => {
        const photo = nikonCamera()
        expect(await photo.camera.getPictureStyle()).toBe('Standard')
        expect(await photo.camera.setPictureStyle('Dream')).toBe('Dream')
        expect(writesTo(photo.body, nikonCodes.pictureControl)).toEqual([{ code: nikonCodes.pictureControl, value: 101 }])
        const video = nikonCamera('video')
        expect(await video.camera.getPictureStyle()).toBe('Same as photo')
    })
})

describe('drive mode', () => {
    it.each([
        ['Sony', sonyCamera, 'Self-timer 10 s', sonyCodes.driveMode, 0x00038004],
        ['Canon', canonCamera, 'Self-timer 10 s', canonCodes.driveMode, 0x10],
        ['Nikon', () => nikonCamera(), 'Self-timer', nikonCodes.driveMode, 0x8011],
        ['standard PTP', standardCamera, 'Continuous', 0x5013, 0x0002],
    ] as const)('%s: Single, then a confirmed change', async (_vendor, simulate, target, code, raw) => {
        const { camera, body } = simulate()
        expect(await camera.getDriveMode()).toBe('Single')
        expect(await camera.setDriveMode(target)).toBe(target)
        expect(writesTo(body, code)).toEqual([{ code, value: raw }])
    })
})

describe('photo / video', () => {
    it('Sony: a composite of the exposure program that keeps the exposure type', async () => {
        const { camera, body } = sonyCamera()
        const control = (await camera.getCapabilities()).controls.photoVideoMode
        expect(control).toMatchObject({ value: 'photo', allowedValues: ['photo', 'video'], writable: true })
        expect(await camera.setPhotoVideoMode('video')).toBe('video')
        expect(writesTo(body, sonyCodes.exposureProgram)).toEqual([{ code: sonyCodes.exposureProgram, value: 0x00078053 }])
        expect((await camera.getCapabilities()).controls.photoVideoMode?.value).toBe('video')
        expect(await camera.setPhotoVideoMode('photo')).toBe('photo')
        expect(body.properties.get(sonyCodes.exposureProgram)!.current).toBe(0x00000001)
    })

    it('Sony: no counterpart advertised is refused before anything is sent; no fallback program is chosen', async () => {
        const { camera, body } = sonyCamera()
        body.properties.get(sonyCodes.exposureProgram)!.current = 0x00078090
        const control = (await camera.getCapabilities()).controls.photoVideoMode
        expect(control).toMatchObject({ value: 'video', allowedValues: ['video'] })
        expect(await camera.setPhotoVideoMode('photo').catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(body.writes).toHaveLength(0)
    })

    it('Sony: an acknowledged program the camera never shows is an unknown outcome, sent once', async () => {
        const { camera, body } = sonyCamera()
        body.applies = false
        const unknown = await camera.setPhotoVideoMode('video').catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown).toMatchObject({ operation: 'photoVideoMode' })
        expect(writesTo(body, sonyCodes.exposureProgram)).toEqual([{ code: sonyCodes.exposureProgram, value: 0x00078053 }])
    }, 20000)

    it('Sony: Still and Movie are counterparts, the same pair recording preparation selects', async () => {
        const { camera, body } = sonyCamera()
        const program = body.properties.get(sonyCodes.exposureProgram)!
        program.current = 0x000a8089
        program.choices = [0x000a8089, 0x000a8088]
        expect((await camera.getCapabilities()).controls.photoVideoMode).toMatchObject({
            value: 'photo',
            allowedValues: ['photo', 'video'],
        })
        expect(await camera.setPhotoVideoMode('video')).toBe('video')
        expect(writesTo(body, sonyCodes.exposureProgram)).toEqual([{ code: sonyCodes.exposureProgram, value: 0x000a8088 }])
        expect(sonyCounterpartExposureProgram('Still')).toBe('Movie')
        expect(sonyCounterpartExposureProgram('Movie Manual')).toBe('Manual')
        expect(sonyCounterpartExposureProgram('Auto')).toBeUndefined()
        expect(sonyExposureProgramKind('S&Q Manual')).toBe('video')
        expect(sonyExposureProgramKind('Mode 0x1234')).toBeUndefined()
    })

    it('Sony: unavailable while the camera reports recording or an unreadable recorder', async () => {
        const { camera, body } = sonyCamera()
        body.properties.get(sonyCodes.movieRecordingState)!.current = 1
        expect(await camera.setPhotoVideoMode('video').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        body.properties.delete(sonyCodes.movieRecordingState)
        expect(await camera.setPhotoVideoMode('video').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(body.writes).toHaveLength(0)
    })

    it('Canon: the movie select switch, confirmed through FixedMovie', async () => {
        const { camera, body } = canonCamera()
        expect(await camera.getPhotoVideoMode()).toBe('photo')
        expect(await camera.setPhotoVideoMode('video')).toBe('video')
        expect(await camera.setPhotoVideoMode('photo')).toBe('photo')
        expect(body.switches).toEqual(['video', 'photo'])
    })

    it('Canon: a refused movie select switch is CameraRefusedError, sent once', async () => {
        const { camera, body } = canonCamera()
        body.refuseWith = 0x200f
        const refused = await camera.setPhotoVideoMode('video').catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).toMatchObject({ operation: 'photoVideoMode' })
        expect(body.switches).toEqual(['video'])
        expect(await camera.getPhotoVideoMode()).toBe('photo')
    })

    it('Canon: a lever held at Movie leaves the outcome unknown, and the switch is sent once', async () => {
        const { camera, body } = canonCamera()
        body.properties.get(canonCodes.fixedMovie)!.current = 1
        body.leverAtMovie = true
        const unknown = await camera.setPhotoVideoMode('photo').catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(body.switches).toEqual(['photo'])
    }, 10000)

    it('Canon: unsupported without the advertised switch operations or the FixedMovie readback', async () => {
        const { camera, body } = canonCamera()
        Reflect.set(protocolSession(camera).driver, 'supportedOperations', new Set([0x1001]))
        expect((await camera.getCapabilities()).controls.photoVideoMode).toMatchObject({ allowedValues: ['photo'], writable: false })
        expect(await camera.setPhotoVideoMode('video').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(body.switches).toEqual([])
        const silent = canonCamera()
        silent.body.properties.delete(canonCodes.fixedMovie)
        expect(await silent.camera.getPhotoVideoMode().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(await silent.camera.setPhotoVideoMode('video').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(silent.body.switches).toEqual([])
    })

    it('Nikon: LiveViewSelector in REMOTE mode, confirmed by readback, with PC-camera mode restored', async () => {
        const { camera, body } = nikonCamera()
        expect(await camera.getPhotoVideoMode()).toBe('photo')
        expect(await camera.setPhotoVideoMode('video')).toBe('video')
        expect(writesTo(body, nikonCodes.selector)).toEqual([{ code: nikonCodes.selector, value: 1 }])
        expect(body.commands).toEqual(['ChangeCameraMode REMOTE', 'ChangeCameraMode PC_CAMERA'])
    })

    it('Nikon: a refused selector is CameraRefusedError, and live view and camera mode are restored', async () => {
        const { camera, body } = nikonCamera()
        body.properties.get(nikonCodes.liveViewStatus)!.current = 1
        body.refuseWith = 0x200f
        const refused = await camera.setPhotoVideoMode('video').catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).toMatchObject({ operation: 'photoVideoMode' })
        expect(writesTo(body, nikonCodes.selector)).toHaveLength(1)
        expect(body.commands).toEqual([
            'ChangeCameraMode REMOTE',
            'EndLiveView',
            'StartLiveView',
            'ChangeCameraMode PC_CAMERA',
        ])
        expect(body.properties.get(nikonCodes.selector)!.current).toBe(0)
    })

    it.each([
        ['whose DeviceReady then fails', (body: NikonBody): void => {
            body.deviceReadyAfterSelector = 0x2002
        }],
        ['the camera never shows', (body: NikonBody): void => {
            body.applies = false
        }],
    ] as const)('Nikon: an acknowledged selector %s is an unknown outcome, never refused or resent', async (_cause, fail) => {
        const { camera, body } = nikonCamera()
        fail(body)
        const unknown = await camera.setPhotoVideoMode('video').catch(error => error)
        expect(unknown).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(unknown).not.toBeInstanceOf(CameraRefusedError)
        expect(unknown).toMatchObject({ operation: 'photoVideoMode' })
        expect(writesTo(body, nikonCodes.selector)).toEqual([{ code: nikonCodes.selector, value: 1 }])
    }, 10000)

    it('standard PTP: no photo/video switch is reported', async () => {
        const { camera } = standardCamera()
        expect((await camera.getCapabilities()).controls.photoVideoMode).toBeUndefined()
        expect(await camera.setPhotoVideoMode('video').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
    })
})

/** A Sony Wi-Fi session over a simulated SDK bridge: `properties` and `set` as the bridge answers them. */
function sonyWifiCamera(properties: Record<string, unknown>[], options: { applies?: boolean } = {}) {
    const sets: { code: string; value: string }[] = []
    const bridge: SonySdkBridge = {
        request: async command => {
            if (command.cmd === 'set') {
                sets.push({ code: String(command.code), value: String(command.value) })
                const property = properties.find(candidate => String(candidate.code) === String(command.code))
                if (property && options.applies !== false) property.value = String(command.value)
                return {}
            }
            expect(command.cmd).toBe('properties')
            return { properties: structuredClone(properties) }
        },
        close: async () => undefined,
    }
    const camera = new SonyWifiCamera(bridge)
    Reflect.set(camera, 'connected', true)
    return { camera, sets }
}

const sdkEnum = (code: number, value: string, allowedValues: string[]) => ({
    code,
    type: 3,
    value,
    writable: true,
    valueForm: 'enum',
    allowedValues,
})

describe('Sony Wi-Fi session', () => {
    it('reads the same canonical names through the SDK labels', async () => {
        const properties: SonySdkProperty[] = [
            { code: 264, type: 0, name: 'WhiteBalance', value: '34', writable: true, valueForm: 'enum', allowedValues: ['0', '17', '34', '257'] },
            { code: 453, type: 0, name: 'CreativeLook', value: '9', writable: true, valueForm: 'enum', allowedValues: ['1', '9'] },
            { code: 426, type: 0, name: 'PictureProfile', value: '8', writable: true, valueForm: 'enum', allowedValues: ['0', '8'] },
            { code: 270, type: 0, name: 'DriveMode', value: '196611', writable: true, valueForm: 'enum', allowedValues: ['1', '196611'] },
        ]
        const bridge: SonySdkBridge = {
            request: async () => ({ properties }),
            close: async () => undefined,
        }
        const camera = new SonyWifiCamera(bridge)
        vi.spyOn(camera, 'getSonyPropertyStates').mockResolvedValue(properties)
        const controls = (await camera.getCapabilities()).controls
        expect(controls.whiteBalance?.allowedValues).toEqual(['Auto', 'Daylight', 'Fluorescent Cool White', 'Custom 1'])
        expect(await camera.getWhiteBalance()).toBe('Fluorescent Cool White')
        expect(await camera.getPictureStyle()).toBe('Monochrome')
        expect(await camera.getPictureProfile()).toBe('PP8')
        expect(await camera.getDriveMode()).toBe('Self-timer 10 s')
    })

    it('writes a typed setting through the SDK and resolves to the readback', async () => {
        const { camera, sets } = sonyWifiCamera([sdkEnum(264, '0', ['0', '17', '18']), sdkEnum(270, '1', ['1', '196611'])])
        expect(await camera.setWhiteBalance('Shade')).toBe('Shade')
        expect(await camera.setDriveMode('Self-timer 10 s')).toBe('Self-timer 10 s')
        expect(sets).toEqual([
            { code: '264', value: '18' },
            { code: '270', value: '196611' },
        ])
        expect(await camera.setWhiteBalance('Flash').catch(error => error)).toBeInstanceOf(CameraRefusedError)
        expect(sets).toHaveLength(2)
    })

    it('reports an SDK value with no documented name as unrecognized, never as a typed value or a choice', async () => {
        const { camera, sets } = sonyWifiCamera([sdkEnum(270, '73730', ['1', '73730']), sdkEnum(264, '0', ['0', '17', '9999'])])
        const controls = (await camera.getCapabilities()).controls
        expect(controls.driveMode).toMatchObject({
            value: 'Unrecognized (0x12002)',
            allowedValues: ['Single'],
            writable: false,
            unrecognized: { value: '0x12002', choices: ['0x12002'] },
        })
        expect(await camera.getDriveMode().catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(await camera.setDriveMode('Single').catch(error => error)).toBeInstanceOf(CameraUnsupportedError)
        expect(controls.whiteBalance).toMatchObject({
            value: 'Auto',
            allowedValues: ['Auto', 'Daylight'],
            writable: true,
            unrecognized: { choices: ['0x270f'] },
        })
        expect(sets).toEqual([])
    })

    it.each([
        ['PTP', () => {
            const { camera, body } = sonyCamera()
            body.properties.set(sonyCodes.exposureProgram, { datatype: 6, current: 0x00000007, choices: [0x00000001, 0x00000007] })
            return { camera, writes: body.writes }
        }],
        ['SDK', () => {
            const { camera, sets } = sonyWifiCamera([sdkEnum(261, '7', ['1', '7'])])
            return { camera, writes: sets }
        }],
    ] as const)('Sony %s: an exposure mode Slate has no name for is read-only and out of the choices', async (_transport, simulate) => {
        const { camera, writes } = simulate()
        expect((await camera.getCapabilities()).controls.exposureMode).toMatchObject({
            value: 'Unrecognized (Portrait)',
            writable: false,
            allowedValues: ['Manual'],
            unrecognized: { value: 'Portrait', choices: ['Portrait'] },
        })
        await expect(camera.getExposureMode()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.setExposureMode('M')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(writes).toEqual([])
    })
})
