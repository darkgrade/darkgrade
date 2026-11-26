/**
 * The connection operations on simulated Sony, Canon, Nikon and generic PTP bodies: connect and
 * connect({ observeOnly }), getInfo from a DeviceInfo dataset encoded with the real codec,
 * disconnect/connect on the same Camera, and the protocol session that replaces getInstance().
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { Camera } from '@camera/index'
import { protocolAccess, protocolSession } from '@camera/protocol-session'
import { PTPResponseError, PTPTimeoutError } from '@core/ptp-errors'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'
import { USBTransport } from '@transport/usb/usb-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodedDeviceInfo, fakeTransport } from '@tests/fixtures/camera-fixtures'
import { canonEvents, canonValue } from '@tests/fixtures/canon-events'

afterEach(() => vi.restoreAllMocks())

const logger = { captureConsole: false, renderInTerminal: false }

const transport = (type = TransportType.USB) => fakeTransport({ getType: () => type, disconnect: async () => undefined })

const identity = { manufacturer: 'Sony Corporation', model: 'ILCE-7M5', deviceVersion: '1.00', serialNumber: '0123456789' }

/** A DeviceInfo dataset as the body sends it: encoded and decoded with the real codec. */
const deviceInfo = (driver: GenericCamera, fields: Partial<DeviceInfo> = {}) =>
    encodedDeviceInfo(driver.registry, { vendorExtensionID: 0x11, operationsSupportedRaw: [0x1001, 0x1002, 0x1003], ...identity, ...fields })

/** Simulated Sony body: the SDIO session and authentication, then the two host-preference writes. */
function sonyBody() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport(), logger, firstContact: false })
    const driver = protocolSession(camera).driver as SonyCamera
    const sent: string[] = []
    vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(driver) }
        return { code: 0x2001 }
    }) as never)
    vi.spyOn(driver, 'refreshPropertyStates').mockResolvedValue([])
    const writes = vi.spyOn(driver, 'set').mockResolvedValue(undefined)
    return { camera, driver, sent, writes }
}

describe('connect', () => {
    it('opens a Sony remote session that claims host priority and saves to the card', async () => {
        const { camera, sent, writes } = sonyBody()
        await camera.connect()
        expect(sent.slice(0, 5)).toEqual(['SDIO_OpenSession', 'SDIO_Connect', 'SDIO_Connect', 'SDIO_GetExtDeviceInfo', 'SDIO_Connect'])
        expect(writes.mock.calls.map(([property, value]) => `${property.name}=${value}`)).toEqual([
            'PositionKeySetting=HOST_PRIORITY',
            'StillImageSaveDestination=CAMERA_DEVICE',
        ])
    })

    it('observeOnly opens the same Sony session without changing a setting', async () => {
        const { camera, driver, sent, writes } = sonyBody()
        const opened = vi.spyOn(driver, 'connect')
        await camera.connect({ observeOnly: true })
        expect(opened).toHaveBeenCalledWith(undefined, { configure: false })
        expect(sent).toEqual(['SDIO_OpenSession', 'SDIO_Connect', 'SDIO_Connect', 'SDIO_GetExtDeviceInfo', 'SDIO_Connect', 'GetDeviceInfo'])
        expect(writes).not.toHaveBeenCalled()
    })

    it('opens Canon remote and event modes unchanged under observeOnly, writing no property', async () => {
        const sessionOperations = ['OpenSession', 'GetDeviceInfo', 'CanonSetRemoteMode', 'CanonSetEventMode', 'CanonGetEventData']
        for (const observeOnly of [false, true]) {
            const { camera, sent } = canonBody()
            await camera.connect({ observeOnly })
            expect(new Set(sent)).toEqual(new Set(sessionOperations))
            expect(sent.slice(0, 4)).toEqual(sessionOperations.slice(0, 4))
            await camera.disconnect()
        }
    })

    it('opens a Nikon and a generic PTP session with OpenSession alone', async () => {
        for (const vendorId of [0x04b0, undefined]) {
            const camera = new Camera({ vendorId, transport: transport(), logger, firstContact: false })
            const driver = protocolSession(camera).driver
            const sent: string[] = []
            vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
                sent.push(operation.name)
                return { code: 0x2001 }
            }) as never)
            await camera.connect({ observeOnly: true })
            expect(sent).toEqual(['OpenSession'])
            expect(driver.sessionId).not.toBeNull()
            await camera.disconnect()
            expect(sent.at(-1)).toBe('CloseSession')
        }
    })

    it('opens the device given as { device }, and refuses a descriptor passed as the options', async () => {
        const { camera, driver } = sonyBody()
        const opened = vi.spyOn(driver, 'connect')
        const device = { usb: { filters: [{ vendorId: 0x054c, serialNumber: 'other-body' }] } }
        await camera.connect({ device, observeOnly: true })
        expect(opened).toHaveBeenCalledWith(device, { configure: false })
        const legacy = device as unknown as Parameters<Camera['connect']>[0]
        await expect(camera.connect(legacy)).rejects.toThrow(TypeError)
    })

})

describe('getInfo', () => {
    // The make is the name people use for the USB vendor; the mount follows only from a Sony ILCE model.
    it.each([
        [0x054c, TransportType.USB, 'usb', 'Sony', 'E'],
        [0x04a9, TransportType.USB, 'usb', 'Canon', undefined],
        [0x04b0, TransportType.IP, 'ip', 'Nikon', undefined],
        [undefined, TransportType.USB, 'usb', 'Sony Corporation', undefined],
    ] as const)('reads vendor %s identity from DeviceInfo over %s', async (vendorId, type, connection, manufacturer, lensMount) => {
        const camera = new Camera({ vendorId, transport: transport(type), logger, keepAlive: false })
        const driver = protocolSession(camera).driver
        const send = vi.spyOn(driver, 'send').mockResolvedValue({ code: 0x2001, data: deviceInfo(driver) } as never)
        expect(await camera.getInfo()).toEqual({
            manufacturer,
            model: 'ILCE-7M5',
            firmware: '1.00',
            serialNumber: '0123456789',
            ...(lensMount && { lensMount }),
            connection,
        })
        expect(send).toHaveBeenCalledTimes(1)
    })

    it("reports Sony's authenticated SDK channel as wifi and omits an unreported serial", async () => {
        const sdk = new SonyRemoteSdkTransport({ host: '192.0.2.10', username: 'user', password: 'secret' }, async () => {
            throw new Error('not opened in this test')
        })
        const camera = new Camera({ vendorId: 0x054c, transport: sdk, logger })
        const driver = protocolSession(camera).driver
        vi.spyOn(driver, 'send').mockResolvedValue({ code: 0x2001, data: deviceInfo(driver, { serialNumber: '' }) } as never)
        const information = await camera.getInfo()
        expect(information.connection).toBe('wifi')
        expect(information).not.toHaveProperty('serialNumber')
    })

    it.each([
        ['a refused GetDeviceInfo', { code: 0x2019 }, CameraRefusedError],
        ['a GetDeviceInfo without a dataset', { code: 0x2001 }, CameraOutcomeUnknownError],
    ] as const)('reports %s as its public error', async (_case, reply, ErrorType) => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport(), logger })
        vi.spyOn(protocolSession(camera).driver, 'send').mockResolvedValue(reply as never)
        const failure = await camera.getInfo().catch(error => error)
        expect(failure).toBeInstanceOf(ErrorType)
        expect(failure).toMatchObject({ operation: 'getInfo' })
        if (reply.code !== 0x2001) expect(failure.message).toContain('0x2019')
    })

})

describe('protocol session', () => {
    it('refuses anything but a Camera; the internal accessor passes a session-shaped helper value through', () => {
        // A Camera-shaped object without a Camera's state, like one built by another copy of Slate.
        const foreign: Camera = Object.create(Camera.prototype)
        expect(() => protocolSession(foreign)).toThrow('protocolSession must be called on a Camera instance')
        const double = { vendorId: 0x04b0, sessionId: 1 }
        expect(protocolAccess(double)).toBe(double)
        const camera = new Camera({ transport: transport(), logger, firstContact: false })
        expect(protocolAccess(camera)).toBe(protocolSession(camera))
    })

    it('reports vendor diagnostics on another vendor as CameraUnsupportedError, sending nothing', async () => {
        const camera = new Camera({ vendorId: 0x04a9, transport: transport(), logger, keepAlive: false })
        const send = vi.spyOn(protocolSession(camera).driver, 'send')
        const session = protocolSession(camera)
        for (const attempt of [
            () => session.sonyPressButton('menu'),
            () => session.getSonyPropertyStates(),
            () => session.connectSonyMenuSession(),
            () => session.getNikonVendorPropertyCodes(),
        ]) {
            const failure = await attempt().catch(error => error)
            expect(failure).toBeInstanceOf(CameraUnsupportedError)
        }
        const sony = protocolSession(new Camera({ vendorId: 0x054c, transport: transport(), logger }))
        expect(() => sony.getCanonNetworkState()).toThrow(CameraUnsupportedError)
        await expect(sony.keepDeviceOn()).rejects.toThrow(CameraUnsupportedError)
        expect(send).not.toHaveBeenCalled()
    })

})

/** Simulated Canon EOS body: OpenSession, DeviceInfo, remote/event modes and one initial event record. */
function canonBody(recordingDestination = 0) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), logger, keepAlive: false, firstContact: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const sent: string[] = []
    let eventReads = 0
    vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
        sent.push(operation.name)
        if (operation.name === 'GetDeviceInfo')
            return { code: 0x2001, data: deviceInfo(driver, { operationsSupportedRaw: [0x1001, 0x1002, 0x1003, 0x9114, 0x9115, 0x9116] }) }
        if (operation.name !== 'CanonGetEventData') return { code: 0x2001 }
        // One CanonRecordStatus value record on the first read, then only the terminator.
        const destination = canonValue(driver.registry.properties.CanonRecordStatus.code, recordingDestination)
        return { code: 0x2001, data: canonEvents(driver.registry, eventReads++ === 0 ? [destination] : []) }
    }) as never)
    return { camera, driver, sent }
}

const openOperations = { 0x054c: 'SDIO_OpenSession', 0x04a9: 'OpenSession', 0x04b0: 'OpenSession', 0x1234: 'OpenSession' } as const

/** A simulated body of each vendor whose session opening is answered by `open`; everything else is OK. */
function bodyAnswering(vendorId: keyof typeof openOperations, open: () => Promise<{ code: number }>) {
    const camera = new Camera({ vendorId, transport: transport(), logger, keepAlive: false, firstContact: false })
    const driver = protocolSession(camera).driver
    vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
        if (operation.name === openOperations[vendorId]) return open()
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(driver) }
        return { code: 0x2001 }
    }) as never)
    return { camera, driver }
}

describe('connection failures', () => {
    const vendors = [
        [0x054c, 'Sony'],
        [0x04a9, 'Canon'],
        [0x04b0, 'Nikon'],
        [0x1234, 'generic'],
    ] as const

    it.each(vendors)('reports a refused session opening on 0x%s (%s) as CameraRefusedError, keeping the PTP error', async vendorId => {
        const { camera, driver } = bodyAnswering(vendorId, async () => ({ code: 0x2019 }))
        const failure = await camera.connect().catch(error => error)
        expect(failure).toBeInstanceOf(CameraRefusedError)
        expect(failure).toMatchObject({ operation: 'connect' })
        expect(failure.cause).toBeInstanceOf(PTPResponseError)
        expect(failure.cause.code).toBe(0x2019)
        // The Sony driver keeps its requested session id after a failed SDIO_OpenSession (unchanged here).
        if (vendorId !== 0x054c) expect(driver.sessionId).toBeNull()
    })

    it.each(vendors)('reports an unanswered session opening on 0x%s (%s) as CameraOutcomeUnknownError, sent once', async vendorId => {
        let opens = 0
        const { camera, driver } = bodyAnswering(vendorId, async () => {
            opens++
            throw new PTPTimeoutError('response', 2000, { operation: openOperations[vendorId] })
        })
        const failure = await camera.connect().catch(error => error)
        expect(failure).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(failure).toMatchObject({ operation: 'connect' })
        expect(failure.cause).toBeInstanceOf(PTPTimeoutError)
        expect(opens).toBe(1)
        // The Sony driver keeps its requested session id after a failed SDIO_OpenSession (unchanged here).
        if (vendorId !== 0x054c) expect(driver.sessionId).toBeNull()
    })

    it.each([0x04b0, 0x1234] as const)('connects 0x%s after a refused attempt on the same Camera', async vendorId => {
        let refuse = true
        const { camera, driver } = bodyAnswering(vendorId, async () => ({ code: refuse ? 0x2019 : 0x2001 }))
        await expect(camera.connect()).rejects.toThrow(CameraRefusedError)
        refuse = false
        await camera.connect()
        expect(protocolSession(camera).driver).toBe(driver)
        expect(driver.sessionId).not.toBeNull()
        // A vendor without a driver of its own keeps the generic one across attempts.
        if (vendorId === 0x1234) expect(Object.getPrototypeOf(driver)).toBe(GenericCamera.prototype)
        await camera.disconnect()
    })

    it('reports a refused CloseSession on disconnect as CameraRefusedError and still releases the session', async () => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport(), logger, firstContact: false })
        const driver = protocolSession(camera).driver
        vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => ({
            code: operation.name === 'CloseSession' ? 0x2003 : 0x2001,
        })) as never)
        await camera.connect()
        const failure = await camera.disconnect().catch(error => error)
        expect(failure).toBeInstanceOf(CameraRefusedError)
        expect(failure).toMatchObject({ operation: 'disconnect' })
        expect(driver.sessionId).toBeNull()
    })

    it('refuses to recover a Canon body while it records to the card, sending no recovery command', async () => {
        const { camera, sent } = canonBody(0x4)
        await camera.connect()
        const before = sent.length
        const failure = await camera.recover().catch(error => error)
        expect(failure).toBeInstanceOf(CameraUnsupportedError)
        expect(failure).toMatchObject({ operation: 'recover', message: 'Stop the Canon recording before recovering its session' })
        expect(sent.slice(before).filter(name => name !== 'CanonGetEventData')).toEqual([])
        await camera.disconnect()
    })

    it('reports an explicitly requested vendor that differs from the opened USB body as CameraRefusedError', async () => {
        const released = vi.fn(async () => undefined)
        const usb: USBTransport = Object.assign(Object.create(USBTransport.prototype), {
            isLittleEndian: () => true,
            isConnected: () => true,
            on: () => undefined,
            getType: () => TransportType.USB,
            disconnect: released,
            getDeviceIdentity: () => ({ vendorId: 0x04b0, productId: 1 }),
        })
        const camera = new Camera({ vendorId: 0x054c, transport: usb, logger, firstContact: false })
        vi.spyOn(protocolSession(camera).driver, 'connectTransport').mockResolvedValue(undefined)
        const vendorProtocol = vi.spyOn(protocolSession(camera).driver, 'connect')
        const failure = await camera.connect().catch(error => error)
        expect(failure).toBeInstanceOf(CameraRefusedError)
        expect(failure.message).toBe('Selected USB camera differs from the explicitly requested vendor')
        expect(vendorProtocol).not.toHaveBeenCalled()
        expect(released).toHaveBeenCalledOnce()
    })

})
