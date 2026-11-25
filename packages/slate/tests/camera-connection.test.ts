/**
 * The connection operations on simulated Sony, Canon, Nikon and generic PTP bodies: connect and
 * connect({ observeOnly }), getInfo from a DeviceInfo dataset encoded with the real codec,
 * disconnect/connect on the same Camera, and the protocol session that replaces getInstance().
 */
import type { CanonCamera } from '@camera/canon-camera'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera } from '@camera/generic-camera'
import { Camera } from '@camera/index'
import { protocolSession } from '@camera/operations/protocol'
import { cameraOperationTable, plannedOperationTable } from '@camera/operations/table'
import type { SonyCamera } from '@camera/sony-camera'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import { TransportType } from '@transport/interfaces/transport-types'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { SonyRemoteSdkTransport } from '@transport/sony-remote/sony-remote-sdk-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

const logger = { captureConsole: false, renderInTerminal: false }

function transport(type = TransportType.USB) {
    return {
        isLittleEndian: () => true,
        isConnected: () => true,
        on: () => undefined,
        getType: () => type,
        disconnect: async () => undefined,
    } as unknown as TransportInterface
}

const identity = { manufacturer: 'Sony Corporation', model: 'ILCE-7M5', deviceVersion: '1.00', serialNumber: '0123456789' }

/** A DeviceInfo dataset as the body sends it: encoded and decoded with the real codec. */
function deviceInfo(driver: GenericCamera, fields: Partial<DeviceInfo> = {}): DeviceInfo {
    const codec = new DeviceInfoCodec(driver.registry)
    return codec.decode(
        codec.encode({
            standardVersion: 100,
            vendorExtensionID: 0x11,
            vendorExtensionVersion: 100,
            vendorExtensionDesc: '',
            functionalMode: 0,
            operationsSupportedRaw: [0x1001, 0x1002, 0x1003],
            operationsSupportedDecoded: [],
            eventsSupportedRaw: [],
            eventsSupportedDecoded: [],
            devicePropertiesSupported: [],
            devicePropertiesSupportedDecoded: [],
            captureFormats: [],
            imageFormatsRaw: [],
            imageFormatsDecoded: [],
            ...identity,
            ...fields,
        })
    ).value
}

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

    it('connectSonyObservationSession and connect({ observeOnly }) open the same session', async () => {
        const first = sonyBody()
        await first.camera.connectSonyObservationSession()
        const second = sonyBody()
        await second.camera.connect({ observeOnly: true })
        expect(second.sent).toEqual(first.sent)
        expect(first.writes).not.toHaveBeenCalled()
    })

    it('opens Canon remote and event modes unchanged under observeOnly, since they change no saved setting', async () => {
        for (const observeOnly of [false, true]) {
            const camera = new Camera({ vendorId: 0x04a9, transport: transport(), logger, keepAlive: false, firstContact: false })
            const driver = protocolSession(camera).driver as CanonCamera
            const opened = vi.spyOn(driver, 'connect').mockResolvedValue(undefined)
            await camera.connect({ observeOnly })
            expect(opened).toHaveBeenCalledWith(undefined)
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

    it('disconnects and reconnects the same Camera, keeping its event subscriptions on the same driver', async () => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport(), logger, firstContact: false })
        const session = protocolSession(camera)
        const driver = session.driver
        const sent: string[] = []
        vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition) => {
            sent.push(operation.name)
            return { code: 0x2001 }
        }) as never)
        await camera.connect()
        await camera.disconnect()
        expect(driver.sessionId).toBeNull()
        await camera.connect()
        expect(session.driver).toBe(driver)
        expect(session.sessionId).toBe(driver.sessionId)
        expect(sent).toEqual(['OpenSession', 'CloseSession', 'OpenSession'])
        await camera.disconnect()
    })
})

describe('getInfo', () => {
    it.each([
        [0x054c, TransportType.USB, 'usb'],
        [0x04a9, TransportType.USB, 'usb'],
        [0x04b0, TransportType.IP, 'ip'],
        [undefined, TransportType.USB, 'usb'],
    ] as const)('reads vendor %s identity from DeviceInfo over %s', async (vendorId, type, connection) => {
        const camera = new Camera({ vendorId, transport: transport(type), logger, keepAlive: false })
        const driver = protocolSession(camera).driver
        const send = vi.spyOn(driver, 'send').mockResolvedValue({ code: 0x2001, data: deviceInfo(driver) } as never)
        expect(await camera.getInfo()).toEqual({
            manufacturer: 'Sony Corporation',
            model: 'ILCE-7M5',
            firmware: '1.00',
            serialNumber: '0123456789',
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
        expect(information).not.toHaveProperty('lensMount')
    })

    it('reports a refused GetDeviceInfo as CameraRefusedError', async () => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport(), logger })
        vi.spyOn(protocolSession(camera).driver, 'send').mockResolvedValue({ code: 0x2019 } as never)
        const failure = await camera.getInfo().catch(error => error)
        expect(failure).toBeInstanceOf(CameraRefusedError)
        expect(failure).toMatchObject({ operation: 'getInfo', message: expect.stringContaining('0x2019') })
    })
})

describe('protocol session', () => {
    it('is one object per Camera that follows the driver connect selects', async () => {
        const camera = new Camera({ transport: transport(), logger, firstContact: false })
        const session = protocolSession(camera)
        expect(protocolSession(camera)).toBe(session)
        expect(session.driver).toBe(camera.getInstance())
        expect(session.vendorId).toBeNull()
    })

    it('passes a session-shaped object through unchanged, so helpers accept either', () => {
        const double = { driver: { vendorId: 0x04b0 }, send: async () => ({ code: 0x2001 }) }
        expect(protocolSession(double as never)).toBe(double)
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
        await expect(sony.keepDeviceOn()).rejects.toThrow('KeepDeviceOn is only available for Canon EOS cameras')
        expect(send).not.toHaveBeenCalled()
    })

    it('sends raw operations on the Camera session and the deprecated Camera methods delegate to it', async () => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport(), logger })
        const session = protocolSession(camera)
        const reply = { code: 0x2001, data: deviceInfo(session.driver) }
        const send = vi.spyOn(session.driver, 'send').mockResolvedValue(reply as never)
        expect(await session.send(session.registry.operations.GetDeviceInfo, {})).toBe(reply)
        expect(await camera.send(session.registry.operations.GetDeviceInfo, {})).toBe(reply)
        expect(send).toHaveBeenCalledTimes(2)
    })
})

describe('operation table', () => {
    it('lists getInfo as current and every replaced connection method with its target', () => {
        expect(cameraOperationTable.getInfo.disposition.kind).toBe('keep')
        expect('getInfo' in plannedOperationTable).toBe(false)
        expect(cameraOperationTable.connectSonyObservationSession.disposition).toMatchObject({
            kind: 'replaced-by',
            target: 'connect',
        })
        expect(cameraOperationTable.connectSonyMenuSession.disposition.kind).toBe('protocol')
        expect(cameraOperationTable.getInstance.disposition.kind).toBe('protocol')
    })
})
