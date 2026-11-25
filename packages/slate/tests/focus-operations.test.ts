/**
 * The focus slice end to end on simulated Sony, Nikon, Canon and standard PTP bodies whose replies
 * are encoded and decoded with the real codecs: autofocus results, focus points, nudges, the focus
 * settings in canonical names, and the refused, unsupported and unknown outcomes of each.
 */
import type { CanonCamera } from '@camera/canon-camera'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@camera/nikon-camera'
import type { SonyCamera } from '@camera/sony-camera'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { CanonLiveViewDatasetCodec } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import { NikonLiveViewDatasetCodec } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import { SDIDevicePropInfoArrayCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { CodecInstance } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { SonyWifiCamera, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/operations/protocol'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const transport = () =>
    ({
        isLittleEndian: () => true,
        isConnected: () => true,
        connect: async () => undefined,
        disconnect: async () => undefined,
        on: () => undefined,
        getType: () => 'USB',
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

// ------------------------------------------------------------------------------------------- Sony

interface SonyValue {
    value: string
    choices?: string[]
    enabled?: boolean
}

/**
 * A simulated Sony body: SDIO property inventory, SetExtDevicePropValue and ControlDevice, every
 * value encoded with the property's own codec. A half-press sets FocusIndication to `focusOnPress`.
 */
const SONY_AREAS = ['Wide', 'Zone', 'Center', 'Flexible Spot S', 'Flexible Spot M', 'Lock on AF Wide', 'Lock on AF Flexible Spot M']

function sonyCamera(initial: { focusArea?: string; subjectDetection?: string; areas?: string[] } = {}) {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const registry = driver.registry
    const properties = registry.properties
    const codecOf = (property: PropertyDefinition): CodecInstance<unknown> =>
        typeof property.codec === 'function' ? property.codec(registry) : property.codec
    const body = {
        values: new Map<PropertyDefinition, SonyValue>([
            [properties.FocusMode, { value: 'AF-S', choices: ['Manual', 'AF-S', 'AF-C', 'DMF'] }],
            [
                properties.FocusArea,
                {
                    value: initial.focusArea ?? 'Wide',
                    choices: initial.areas ?? SONY_AREAS,
                },
            ],
            [properties.SubjectRecognitionInAF, { value: initial.subjectDetection ?? 'On', choices: ['Off', 'On'] }],
            [properties.RecognitionTarget, { value: 'Person', choices: ['Person', 'Animal', 'Bird'] }],
            [properties.RightLeftEyeSelect, { value: 'Auto', choices: ['Auto', 'Right Eye', 'Left Eye'] }],
            [properties.FaceEyeFrameDisplay, { value: 'OFF', choices: ['OFF', 'ON'] }],
            [properties.FocusIndication, { value: 'UNLOCK' }],
        ]),
        focusOnPress: 'AF_S_FOCUSED',
        halfPressResponse: 0x2001,
        applies: true,
        afterRelease: () => {},
    }
    const positions: { x: number; y: number }[] = []
    const writes: { name: string; value: unknown }[] = []
    /** The bytes of each property write, as sent. */
    const wire: { name: string; data: number[] }[] = []
    const halfPresses: string[] = []
    const inventoryReads = { count: 0 }
    const descriptor = (property: PropertyDefinition, state: SonyValue) => {
        const codec = codecOf(property)
        const current = codec.encode(state.value)
        return concatenate([
            registry.codecs.uint16.encode(property.code),
            registry.codecs.uint16.encode(property.datatype),
            registry.codecs.uint8.encode(property.access === 'Get' ? 0 : 1),
            registry.codecs.uint8.encode(state.enabled === false ? 2 : 1),
            current,
            current,
            ...(state.choices
                ? [
                      registry.codecs.uint8.encode(2),
                      registry.codecs.uint16.encode(state.choices.length),
                      ...state.choices.map(choice => codec.encode(choice)),
                  ]
                : [registry.codecs.uint8.encode(0)]),
        ])
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, unknown>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, 0x9209, 0x9205, 0x9207]) }
        if (operation.name === 'SDIO_GetAllExtDevicePropInfo') {
            inventoryReads.count++
            const entries = [...body.values.entries()]
            const wire = concatenate([
                registry.codecs.uint32.encode(entries.length),
                registry.codecs.uint32.encode(0),
                ...entries.map(([property, state]) => descriptor(property, state)),
            ])
            return { code: 0x2001, data: new SDIDevicePropInfoArrayCodec(registry).decode(wire).value }
        }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const property = [...body.values.keys()].find(candidate => candidate.code === parameters.DevicePropCode)!
            const value = codecOf(property).decode(data!).value
            writes.push({ name: property.name, value })
            wire.push({ name: property.name, data: [...data!] })
            if (body.applies) body.values.get(property)!.value = String(value)
            return { code: 0x2001 }
        }
        if (operation.name === 'SDIO_ControlDevice') {
            const code = parameters.sdiControlCode
            if (code === 0xd2dc) {
                const packed = registry.codecs.uint32.decode(data!).value
                positions.push({ x: packed >>> 16, y: packed & 0xffff })
                return { code: 0x2001 }
            }
            if (code === properties.ShutterHalfReleaseButton.code) {
                const press = String(codecOf(properties.ShutterHalfReleaseButton).decode(data!).value)
                halfPresses.push(press)
                if (press === 'DOWN' && body.halfPressResponse !== 0x2001) return { code: body.halfPressResponse }
                const indication = body.values.get(properties.FocusIndication)!
                if (press === 'DOWN') indication.value = body.focusOnPress
                else body.afterRelease()
                return { code: 0x2001 }
            }
            return { code: 0x2001 }
        }
        // Opening and closing a session: the handshake is acknowledged, nothing else is simulated.
        if (/Session|SDIO_Connect|SDIO_GetExtDeviceInfo/.test(operation.name)) return { code: 0x2001 }
        throw new Error(`Unexpected Sony operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const value = (property: PropertyDefinition) => body.values.get(property)!.value
    return { camera, driver, body, positions, writes, wire, halfPresses, inventoryReads, value, properties }
}

describe('focus on a simulated Sony body', () => {
    it('reports the focus result the body gave: acquired, not-acquired, or unknown in movie mode', async () => {
        const { camera, body, halfPresses } = sonyCamera()
        expect(await camera.autofocus()).toBe('acquired')
        expect(halfPresses).toEqual(['DOWN', 'UP'])
        body.focusOnPress = 'AF_S_NOT_FOCUSED'
        expect(await camera.autofocus()).toBe('not-acquired')
        // Bench finding: in movie mode the body stays at UNLOCK on a half-press.
        body.focusOnPress = 'UNLOCK'
        expect(await camera.autofocus()).toBe('unknown')
        expect(halfPresses).toHaveLength(6)
    })

    it('shows face and eye frames once a session while subject detection is on, from the inventory it read', async () => {
        const { camera, value, properties, writes, inventoryReads } = sonyCamera()
        await camera.getCapabilities()
        expect(value(properties.FaceEyeFrameDisplay)).toBe('ON')
        await camera.getCapabilities()
        // autofocus checks the frames from the last inventory: no read of its own beyond its focus polls.
        const readsBeforeFirst = inventoryReads.count
        await camera.autofocus()
        const readsOfFirst = inventoryReads.count - readsBeforeFirst
        await camera.autofocus()
        expect(inventoryReads.count - readsBeforeFirst - readsOfFirst).toBe(readsOfFirst)
        expect(writes.filter(write => write.name === 'FaceEyeFrameDisplay')).toHaveLength(1)
    })

    it('leaves Face/Eye Frame Display alone while subject detection is off, until it is turned on', async () => {
        const { camera, value, properties } = sonyCamera({ subjectDetection: 'Off' })
        await camera.getCapabilities()
        await camera.autofocus()
        expect(value(properties.FaceEyeFrameDisplay)).toBe('OFF')
        expect(await camera.setSubjectDetection('On')).toBe('On')
        await camera.getCapabilities()
        expect(value(properties.FaceEyeFrameDisplay)).toBe('ON')
    })

    it('refuses when the body rejects the half-press, and sends nothing more', async () => {
        const { camera, body, halfPresses } = sonyCamera()
        body.halfPressResponse = 0x2019
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraRefusedError)
        expect(halfPresses).toEqual(['DOWN'])
    })

    it('reports unknown when the controls never come back after the release', async () => {
        const { camera, body, properties } = sonyCamera()
        body.afterRelease = () => (body.values.get(properties.FocusMode)!.enabled = false)
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
    }, 10_000)

    it('places a point from Wide by switching to a spot and pausing subject detection, then puts both back', async () => {
        const { camera, positions, value, properties, halfPresses } = sonyCamera()
        await camera.setFocusPoint(0.5, 0.25)
        expect(value(properties.FocusArea)).toBe('Flexible Spot M')
        expect(value(properties.SubjectRecognitionInAF)).toBe('Off')
        expect(positions).toEqual([{ x: 320, y: 120 }])
        expect(halfPresses).toEqual(['DOWN', 'UP'])
        expect(await camera.getFocusArea()).toBe('Spot M')

        await camera.resetFocusPoint()
        expect(positions.at(-1)).toEqual({ x: 320, y: 240 })
        expect(value(properties.FocusArea)).toBe('Wide')
        expect(value(properties.SubjectRecognitionInAF)).toBe('On')
        expect(await camera.getFocusArea()).toBe('Wide')
    })

    it('keeps Lock-on AF when it switches to a spot, and moves a spot as it is', async () => {
        const tracking = sonyCamera({ focusArea: 'Lock on AF Wide' })
        await tracking.camera.setFocusPoint(0.1, 0.9, { autofocus: false })
        expect(tracking.value(tracking.properties.FocusArea)).toBe('Lock on AF Flexible Spot M')
        expect(tracking.halfPresses).toEqual([])

        const spot = sonyCamera({ focusArea: 'Flexible Spot S', subjectDetection: 'Off' })
        await spot.camera.setFocusPoint(1, 1, { autofocus: false })
        expect(spot.writes).toEqual([])
        expect(spot.positions).toEqual([{ x: 639, y: 479 }])
        await spot.camera.resetFocusPoint()
        expect(spot.value(spot.properties.FocusArea)).toBe('Flexible Spot S')
        expect(spot.positions.at(-1)).toEqual({ x: 320, y: 240 })
    })

    it('keeps an area or subject detection the application chose after the point', async () => {
        const { camera, value, properties } = sonyCamera()
        await camera.setFocusPoint(0.5, 0.5, { autofocus: false })
        expect(await camera.setFocusArea('Zone')).toBe('Zone')
        expect(await camera.setSubjectDetection('Off')).toBe('Off')
        await camera.resetFocusPoint()
        expect(value(properties.FocusArea)).toBe('Zone')
        expect(value(properties.SubjectRecognitionInAF)).toBe('Off')
    })

    it('forgets what a point changed when the same Camera disconnects and connects again', async () => {
        const { camera, value, properties, writes } = sonyCamera()
        await camera.setFocusPoint(0.5, 0.5, { autofocus: false })
        expect(value(properties.FocusArea)).toBe('Flexible Spot M')
        await camera.disconnect()
        await camera.connect()
        // The user's spot in the new session stays where it is: nothing from the old session is undone.
        const before = writes.length
        await camera.resetFocusPoint()
        expect(writes.slice(before).filter(write => write.name !== 'FaceEyeFrameDisplay')).toEqual([])
        expect(value(properties.FocusArea)).toBe('Flexible Spot M')
        expect(value(properties.SubjectRecognitionInAF)).toBe('Off')
    })

    it('refuses a point outside the picture before sending anything', async () => {
        const { camera, positions, writes } = sonyCamera()
        await expect(camera.setFocusPoint(1.2, 0.5)).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.setFocusPoint(Number.NaN, 0.5)).rejects.toBeInstanceOf(CameraRefusedError)
        expect([positions, writes]).toEqual([[], []])
    })

    it('says in getCapabilities which focus operations it has, and refuses nudges as unsupported', async () => {
        const { camera } = sonyCamera()
        const { operations } = await camera.getCapabilities()
        expect(operations).toMatchObject({
            autofocus: { supported: true },
            setFocusPoint: { supported: true },
            resetFocusPoint: { supported: true },
            nudgeFocus: { supported: false, reason: expect.stringContaining('Sony') },
        })
        await expect(camera.nudgeFocus('near', 'small')).rejects.toBeInstanceOf(CameraUnsupportedError)
    })

    it('names the focus settings canonically and writes the camera’s own value', async () => {
        const { camera, writes } = sonyCamera()
        const controls = (await camera.getCapabilities()).controls
        expect(controls.focusMode).toMatchObject({ value: 'AF-S', allowedValues: ['MF', 'AF-S', 'AF-C', 'DMF'] })
        expect(controls.focusArea?.allowedValues).toEqual(['Wide', 'Zone', 'Center', 'Spot S', 'Spot M', 'Tracking Wide', 'Tracking Spot M'])
        expect(await camera.getDetectionSubject()).toBe('People')
        expect(await camera.getEyeSelection()).toBe('Auto')
        expect(await camera.setFocusMode('MF')).toBe('MF')
        expect(await camera.setEyeSelection('Left')).toBe('Left')
        expect(await camera.setDetectionSubject('Birds')).toBe('Birds')
        expect(writes).toEqual([
            { name: 'FaceEyeFrameDisplay', value: 'ON' },
            { name: 'FocusMode', value: 'Manual' },
            { name: 'RightLeftEyeSelect', value: 'Left Eye' },
            { name: 'RecognitionTarget', value: 'Bird' },
        ])
        await expect(camera.setFocusMode('AF-A')).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.setControl('focusMode', 'Manual')).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('writes the tracking spot this body offers when two Sony values share its name', async () => {
        const current = sonyCamera({ subjectDetection: 'Off' })
        expect(await current.camera.setFocusArea('Tracking Spot M')).toBe('Tracking Spot M')
        expect(current.wire).toEqual([{ name: 'FocusArea', data: [0x05, 0x02] }])

        const older = sonyCamera({
            subjectDetection: 'Off',
            areas: ['Wide', 'Flexible Spot M', 'Tracking Flexible Spot S', 'Tracking Flexible Spot M'],
        })
        expect(await older.camera.setControl('focusArea', 'Tracking Spot M')).toMatchObject({ value: 'Tracking Spot M' })
        expect(older.wire).toEqual([{ name: 'FocusArea', data: [0x02, 0x03] }])

        // A body offering both Sony values under one name cannot be written by that name.
        const both = sonyCamera({ subjectDetection: 'Off', areas: ['Wide', 'Lock on AF Flexible Spot M', 'Tracking Flexible Spot M'] })
        await expect(both.camera.setFocusArea('Tracking Spot M')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(both.wire).toEqual([])
    })

    it('treats an older Tracking Flexible Spot as a tracking spot of that size, not as a plain area', async () => {
        const { camera, value, properties } = sonyCamera({
            focusArea: 'Tracking Flexible Spot S',
            subjectDetection: 'Off',
            areas: ['Wide', 'Flexible Spot S', 'Flexible Spot M', 'Lock on AF Wide', 'Tracking Flexible Spot S'],
        })
        await camera.setFocusPoint(0.5, 0.5, { autofocus: false })
        expect(value(properties.FocusArea)).toBe('Tracking Flexible Spot S')
        expect(await camera.setFocusArea('Wide')).toBe('Wide')
        await camera.setFocusPoint(0.5, 0.5, { autofocus: false })
        expect(value(properties.FocusArea)).toBe('Flexible Spot S')
        expect(await camera.setFocusArea('Tracking Wide')).toBe('Tracking Wide')
        await camera.setFocusPoint(0.5, 0.5, { autofocus: false })
        expect(value(properties.FocusArea)).toBe('Tracking Flexible Spot S')
    })

    it('reports a focus-mode write the body never shows as unknown, without resending it', async () => {
        const { camera, body, writes } = sonyCamera()
        body.applies = false
        await expect(camera.setFocusMode('AF-C')).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
        expect(writes).toHaveLength(1)
    }, 15_000)
})

// ------------------------------------------------------------------------------------------ Nikon

/** Nikon LiveViewObject (big-endian, version 2.1), with the AF fields the focus operations read. */
function nikonLiveView(frame: { centerX: number; centerY: number; judgement: number; driving: number }): Uint8Array {
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    const header = new Uint8Array(56)
    const view = new DataView(header.buffer)
    view.setUint16(0, 2)
    view.setUint16(2, 1)
    view.setUint32(8, header.length)
    view.setUint32(12, jpeg.length)
    view.setUint16(16, 6048)
    view.setUint16(18, 3400)
    view.setUint16(20, 6048)
    view.setUint16(22, 3400)
    view.setUint16(28, 640)
    view.setUint16(30, 360)
    view.setUint8(40, 1)
    view.setUint8(41, frame.driving)
    view.setUint8(42, frame.judgement)
    view.setUint16(48, 400)
    view.setUint16(50, 400)
    view.setUint16(52, frame.centerX)
    view.setUint16(54, frame.centerY)
    return concatenate([header, jpeg])
}

function nikonCamera(options: { advertised?: string[] } = {}) {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const operations = driver.registry.operations
    const advertised = (options.advertised ?? ['AfDrive', 'AfDriveCancel', 'ChangeAfArea', 'MfDrive', 'DeviceReady', 'StartLiveView', 'GetLiveViewImageEx'])
        .map(name => Object.values(operations).find(operation => operation.name === name)!.code)
    const frame = { centerX: 3024, centerY: 1700, judgement: 0, driving: 0 }
    const body = { acquires: true, followsPoint: true, responses: new Map<string, number>() }
    const calls: { name: string; parameters: Record<string, unknown> }[] = []
    const send = async (operation: OperationDefinition, parameters: Record<string, number>) => {
        calls.push({ name: operation.name, parameters })
        const code = body.responses.get(operation.name)
        if (code !== undefined) return { code }
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, ...advertised]) }
        if (operation.name === 'GetLiveViewImageEx')
            return { code: 0x2001, data: new NikonLiveViewDatasetCodec(driver.registry).decode(nikonLiveView(frame)).value }
        if (operation.name === 'AfDrive') {
            frame.judgement = body.acquires ? 2 : 1
            return { code: 0x2001 }
        }
        if (operation.name === 'ChangeAfArea') {
            if (body.followsPoint) [frame.centerX, frame.centerY] = [parameters.X!, parameters.Y!]
            return { code: 0x2001 }
        }
        if (operation.name === 'GetDevicePropDesc' || operation.name === 'GetDevicePropDescEx') return { code: 0x200a }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, calls, frame }
}

describe('focus on a simulated Nikon body', () => {
    it('reports acquired only when the camera judges focus, otherwise not-acquired', async () => {
        const { camera, body } = nikonCamera()
        expect(await camera.autofocus()).toBe('acquired')
        body.acquires = false
        expect(await camera.autofocus()).toBe('not-acquired')
    })

    it('places a point on the whole-size AF plane and confirms the AF frame moved there', async () => {
        const { camera, calls } = nikonCamera()
        await camera.setFocusPoint(0.25, 0.75)
        expect(calls.find(call => call.name === 'ChangeAfArea')?.parameters).toEqual({ X: 1512, Y: 2549 })
        expect(calls.filter(call => call.name === 'AfDrive')).toHaveLength(1)
        await camera.resetFocusPoint()
        expect(calls.filter(call => call.name === 'ChangeAfArea').at(-1)?.parameters).toEqual({ X: 3024, Y: 1700 })
        expect(calls.filter(call => call.name === 'AfDrive')).toHaveLength(1)
    })

    it('reports a point the camera accepted but does not show as unknown, sent once', async () => {
        const { camera, body, calls } = nikonCamera()
        body.followsPoint = false
        await expect(camera.setFocusPoint(0.1, 0.1, { autofocus: false })).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
        expect(calls.filter(call => call.name === 'ChangeAfArea')).toHaveLength(1)
    })

    it('nudges by named sizes mapped to MfDrive steps', async () => {
        const { camera, calls } = nikonCamera()
        await camera.nudgeFocus('near', 'small')
        await camera.nudgeFocus('far', 'medium')
        await camera.nudgeFocus('far', 'large')
        expect(calls.filter(call => call.name === 'MfDrive').map(call => call.parameters)).toEqual([
            { Direction: 1, Steps: 10 },
            { Direction: 2, Steps: 100 },
            { Direction: 2, Steps: 500 },
        ])
    })

    it('refuses with the camera’s reason when the lens is at its end, and never resends', async () => {
        const { camera, body, calls } = nikonCamera()
        body.responses.set('MfDrive', 0xa00c)
        const refused = await camera.nudgeFocus('near', 'small').catch(error => error)
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused.message).toContain('MfDriveStepEnd')
        expect(calls.filter(call => call.name === 'MfDrive')).toHaveLength(1)
        body.responses.set('AfDrive', 0x2019)
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('reports what a body without the focus operations cannot do, before sending any', async () => {
        const { camera, calls } = nikonCamera({ advertised: ['DeviceReady', 'StartLiveView', 'GetLiveViewImageEx'] })
        const { operations } = await camera.getCapabilities()
        expect(operations?.autofocus).toEqual({ supported: false, reason: 'The camera does not advertise AfDrive, AfDriveCancel' })
        expect(operations?.nudgeFocus).toMatchObject({ supported: false })
        calls.length = 0
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.nudgeFocus('far', 'small')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(calls.map(call => call.name)).toEqual(['GetDeviceInfo', 'GetDeviceInfo'])
    })
})

// ------------------------------------------------------------------------------------------ Canon

function words(length: number, ...values: number[]): Uint8Array {
    const wire = new Uint8Array(length)
    const view = new DataView(wire.buffer)
    values.forEach((value, index) => view.setUint32(index * 4, value, true))
    return wire
}

/**
 * A simulated EOS body: CanonGetEventData records for each property (and the FixedMovie state),
 * CanonSetPropValue writes, and a viewfinder frame whose zoom-border segments follow
 * CanonViewfinderPosition.
 */
function canonCamera(initial: { focusMode?: number; servo?: number; video?: boolean; magnification?: number } = {}) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const properties = driver.registry.properties
    const operations = driver.registry.operations
    const body = {
        values: new Map<number, { current: number; choices: number[] }>([
            [properties.CanonFocusMode.code, { current: initial.focusMode ?? 0, choices: [0, 1, 3] }],
            [properties.CanonMovieServoAutofocus.code, { current: initial.servo ?? 1, choices: [0, 1] }],
            [properties.CanonContinuousAutofocus.code, { current: 0, choices: [0, 1] }],
            [properties.CanonLiveViewMode.code, { current: 3, choices: [0, 1, 2, 3] }],
        ]),
        fixedMovie: initial.video ? 1 : 0,
        frame: { x: 2700, y: 1800, magnification: initial.magnification ?? 1 },
        autofocusResponse: 0x2001,
        halfPressResponse: 0x2001,
    }
    const advertised = [
        'CanonGetEventData',
        'CanonSetPropValue',
        'CanonDoAutofocus',
        'CanonCancelAutofocus',
        'CanonRemoteReleaseOn',
        'CanonRemoteReleaseOff',
        'CanonGetViewfinderData',
        'CanonViewfinderPosition',
    ].map(name => Object.values(operations).find(operation => operation.name === name)!.code)
    Reflect.set(driver, 'supportedOperations', new Set(advertised))
    const calls: { name: string; parameters: Record<string, unknown> }[] = []
    const writes: { code: number; value: number }[] = []
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        calls.push({ name: operation.name, parameters })
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(camera, [], [0x1001, ...advertised]) }
        if (operation.name === 'CanonGetEventData') {
            const records = [...body.values.entries()].flatMap(([code, state]) => [
                words(16, 16, 0xc189, code, state.current),
                words(20 + state.choices.length * 4, 20 + state.choices.length * 4, 0xc18a, code, 3, state.choices.length, ...state.choices),
            ])
            const wire = concatenate([...records, words(16, 16, 0xc189, 0xd1c2, body.fixedMovie), words(8, 8, 0)])
            return { code: 0x2001, data: new CanonEventDataCodec(driver.registry).decode(wire).value }
        }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            const write = { code: view.getUint32(4, true), value: view.getUint32(8, true) }
            writes.push(write)
            body.values.get(write.code)!.current = write.value
            return { code: 0x2001 }
        }
        if (operation.name === 'CanonDoAutofocus') return { code: body.autofocusResponse }
        if (operation.name === 'CanonRemoteReleaseOn') return { code: body.halfPressResponse, parameters: [0] }
        if (operation.name === 'CanonViewfinderPosition') {
            ;[body.frame.x, body.frame.y] = [parameters.X!, parameters.Y!]
            return { code: 0x2001 }
        }
        if (operation.name === 'CanonGetViewfinderData') {
            const { x, y, magnification } = body.frame
            const wire = concatenate([
                concatenate([words(8, 12, 1), Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)]),
                words(12, 12, 4, magnification),
                words(16, 16, 5, x, y),
                words(24, 24, 13, x, y, 600, 400),
                words(16, 16, 14, 6000, 4000),
                words(24, 24, 19, 0, 0, 6000, 4000),
            ])
            return { code: 0x2001, data: new CanonLiveViewDatasetCodec(driver.registry).decode(wire).value }
        }
        return { code: 0x2001 }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, calls, writes, properties }
}

describe('focus on a simulated Canon body', () => {
    it('reports a timed AF hold as unknown, and refuses when the body accepts neither AF command', async () => {
        const { camera, body, calls } = canonCamera()
        expect(await camera.autofocus()).toBe('unknown')
        expect(calls.map(call => call.name)).toEqual(['CanonDoAutofocus', 'CanonCancelAutofocus'])
        body.autofocusResponse = 0x2019
        body.halfPressResponse = 0x2019
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraRefusedError)
    })

    it('moves the AF frame (the zoom border) to a point and back to the centre, confirmed by readback', async () => {
        const { camera, body, calls } = canonCamera()
        await camera.setFocusPoint(0.5, 0.25)
        expect(calls.find(call => call.name === 'CanonViewfinderPosition')?.parameters).toEqual({ X: 2700, Y: 800 })
        expect(calls.some(call => call.name === 'CanonDoAutofocus')).toBe(true)
        await camera.resetFocusPoint()
        expect(body.frame).toMatchObject({ x: 2700, y: 1800 })
        await camera.setFocusPoint(1, 1, { autofocus: false })
        expect(body.frame).toMatchObject({ x: 5400, y: 3600 })
    })

    it('does not place a point in magnified live view, and has no manual focus steps', async () => {
        const { camera, calls } = canonCamera({ magnification: 5 })
        await expect(camera.setFocusPoint(0.5, 0.5)).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(calls.some(call => call.name === 'CanonViewfinderPosition')).toBe(false)
        await expect(camera.nudgeFocus('near', 'large')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect((await camera.getCapabilities()).operations?.nudgeFocus).toMatchObject({ supported: false })
    })

    it('resets the point in magnified live view too: the frame goes back to the centre', async () => {
        const { camera, body, calls } = canonCamera({ magnification: 5 })
        body.frame.x = 4000
        body.frame.y = 3000
        await camera.resetFocusPoint()
        expect(calls.filter(call => call.name === 'CanonViewfinderPosition').map(call => call.parameters)).toEqual([
            { X: 2700, Y: 1800 },
        ])
        expect(body.frame).toMatchObject({ x: 2700, y: 1800, magnification: 5 })
    })

    it('names One-Shot, AI Servo and manual AF-S, AF-C and MF, and writes the EOS value', async () => {
        const { camera, writes, properties } = canonCamera()
        const controls = (await camera.getCapabilities()).controls
        expect(controls.focusMode).toMatchObject({ value: 'AF-S', allowedValues: ['AF-S', 'AF-C', 'MF'], source: { name: 'CanonFocusMode' } })
        expect(controls.continuousAutofocus).toMatchObject({ value: 'Off', allowedValues: ['Off', 'On'] })
        expect(await camera.setFocusMode('AF-C')).toBe('AF-C')
        expect(writes).toEqual([{ code: properties.CanonFocusMode.code, value: 1 }])
        await expect(camera.setFocusMode('AF-A')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toHaveLength(1)
    })

    it('folds Movie Servo AF into the focus mode in video mode, unless the lens is at MF', async () => {
        const video = canonCamera({ video: true, servo: 1 })
        expect(await video.camera.getFocusMode()).toBe('AF-C')
        expect(await video.camera.setFocusMode('AF-S')).toBe('AF-S')
        expect(video.writes).toEqual([{ code: video.properties.CanonMovieServoAutofocus.code, value: 0 }])

        const manual = canonCamera({ video: true, servo: 1, focusMode: 3 })
        expect((await manual.camera.getCapabilities()).controls.focusMode).toMatchObject({
            value: 'MF',
            source: { name: 'CanonFocusMode' },
        })
    })
})

// ------------------------------------------------------------------------------- Standard PTP

describe('focus on a standard PTP body', () => {
    function genericCamera() {
        const camera = new Camera({ transport: transport() })
        const registry = protocolSession(camera).driver.registry
        const focusMode = registry.properties.FocusMode
        const descriptor = () => {
            const wire = concatenate([
                registry.codecs.uint16.encode(focusMode.code),
                registry.codecs.uint16.encode(focusMode.datatype),
                Uint8Array.of(1),
                registry.codecs.uint16.encode(2),
                registry.codecs.uint16.encode(2),
                Uint8Array.of(2),
                registry.codecs.uint16.encode(2),
                registry.codecs.uint16.encode(1),
                registry.codecs.uint16.encode(2),
            ])
            return new DevicePropDescCodec(registry).decode(wire).value
        }
        vi.spyOn(protocolSession(camera).driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
            if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(camera, [focusMode.code], [0x1001]) }
            if (operation.name === 'GetDevicePropDesc') return { code: 0x2001, data: descriptor() }
            return { code: 0x2001 }
        }) as never)
        return camera
    }

    it('reports every focus operation as unsupported, with the reason, and throws CameraUnsupportedError', async () => {
        const camera = genericCamera()
        const { operations, controls } = await camera.getCapabilities()
        const focusOperations = ['autofocus', 'setFocusPoint', 'resetFocusPoint', 'nudgeFocus'] as const
        expect(focusOperations.every(name => operations?.[name]?.supported === false)).toBe(true)
        expect(controls.focusMode).toMatchObject({ value: 'AF', allowedValues: ['MF', 'AF'] })
        await expect(camera.autofocus()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.setFocusPoint(0.5, 0.5)).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.resetFocusPoint()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.nudgeFocus('near', 'small')).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})

// ---------------------------------------------------------------------------- Sony Wi-Fi session

describe('focus settings on the Sony Wi-Fi (Camera Remote SDK) session', () => {
    it('names the SDK focus mode canonically, writes its own value and confirms the readback', async () => {
        let value = '2'
        const sets: string[] = []
        const bridge: SonySdkBridge = {
            request: async command => {
                if (command.cmd === 'fingerprint') return { ok: true, fingerprint: 'aabbcc' }
                if (command.cmd === 'properties')
                    return { properties: [{ code: 265, type: 2, value, writable: true, allowedValues: ['1', '2', '3'] }] }
                if (command.cmd === 'set') {
                    sets.push(command.value!)
                    value = command.value!
                }
                return { ok: true }
            },
            close: async () => undefined,
        }
        const camera = new SonyWifiCamera(bridge)
        await camera.connect({
            host: '192.0.2.98',
            mac: '0C:80:2F:A7:36:AD',
            username: 'operator',
            password: 'runtime-example',
            fingerprint: 'aabbcc',
        })
        expect(await camera.getFocusMode()).toBe('AF-S')
        expect((await camera.getCapabilities()).controls.focusMode?.allowedValues).toEqual(['MF', 'AF-S', 'AF-C'])
        expect(await camera.setFocusMode('MF')).toBe('MF')
        await expect(camera.setFocusMode('DMF')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(sets).toEqual(['1'])
    })
})
