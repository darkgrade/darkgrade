import { Camera } from '@camera/index'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { validateCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import {
    ProfileDataMissingError,
    SimulatedDisconnectError,
    SimulatedTransport,
} from '@transport/simulated/simulated-transport'
import { describe, expect, it } from 'vitest'

/**
 * Mechanics fixture for the simulator itself. It is not a camera profile and is never part of
 * the support matrix; its values exercise each code path.
 */
function fixture(overrides: Partial<CameraProfile> = {}): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'simulator-fixture',
        manufacturer: 'Fixture',
        line: 'Test',
        model: 'Simulator fixture',
        provenance: {
            fidelity: 'documented',
            sources: [{ location: 'tests/camera-simulation/simulated-transport.test.ts' }],
        },
        deviceInfo: {
            manufacturer: 'Fixture Manufacturer',
            model: 'Fixture Model',
            operationsSupported: ['0x1001', '0x1002', '0x1003', '0x1014', '0x1015', '0x1016', '0x100e'],
            eventsSupported: ['0x4002', '0x4006'],
            devicePropertiesSupported: ['0x5001', '0x5005', '0x500f'],
            listsComplete: true,
            source: 0,
        },
        properties: [
            {
                code: '0x5001',
                descriptor: {
                    dataType: '0x0002',
                    writable: false,
                    factoryDefault: 100,
                    current: 64,
                    form: { range: { minimum: 0, maximum: 100, step: 1 } },
                },
                source: 0,
            },
            {
                code: '0x5005',
                descriptor: {
                    dataType: '0x0004',
                    writable: true,
                    factoryDefault: 2,
                    current: 2,
                    form: { enumeration: [2, 4] },
                },
                source: 0,
            },
        ],
        exchanges: [
            { operation: '0x100e', parameters: ['0x0', '0x0'], response: { code: '0x2001' }, source: 0 },
            { operation: '0x9001', parameters: [], response: { code: '0x2001', parameters: ['0x7'] }, source: 0 },
            { operation: '0x9001', parameters: [], response: { code: '0x2019' }, source: 0 },
        ],
        events: [{ code: '0x4002', parameters: ['0x1234'], afterOperation: '0x100e', source: 0 }],
        quirks: [],
        ...overrides,
    }
}

function camera(profile: CameraProfile) {
    const transport = new SimulatedTransport(profile)
    const simulated = new Camera({ transport, logger: { renderInTerminal: false, captureConsole: false } })
    return { transport, camera: simulated, instance: simulated.getInstance() }
}

describe('SimulatedTransport', () => {
    it('validates the fixture', () => {
        expect(validateCameraProfile(fixture())).toEqual([])
    })

    it('answers OpenSession, then SessionAlreadyOpen, and encodes DeviceInfo that darkgrade decodes', async () => {
        const { camera: simulated, instance } = camera(fixture())
        await simulated.connect()
        const again = await instance.send(genericOperationRegistry.OpenSession, { SessionID: 9 })
        expect(again.code).toBe(0x201e)

        const response = await instance.send(genericOperationRegistry.GetDeviceInfo, {})
        const deviceInfo = response.data
        expect(deviceInfo.manufacturer).toBe('Fixture Manufacturer')
        expect(deviceInfo.model).toBe('Fixture Model')
        expect(deviceInfo.operationsSupportedRaw).toContain(0x100e)
        expect(deviceInfo.devicePropertiesSupported).toEqual([0x5001, 0x5005, 0x500f])
    })

    it('serves descriptors, keeps written values, and refuses read-only and unlisted values', async () => {
        const { camera: simulated, instance, transport } = camera(fixture())
        await simulated.connect()
        const changed: unknown[] = []
        simulated.on(genericEventRegistry.DevicePropChanged, parameters => changed.push(parameters))

        expect(await simulated.get(genericPropertyRegistry.BatteryLevel)).toBe(64)
        await simulated.set(genericPropertyRegistry.WhiteBalance, 4)
        expect(transport.responseCodes.at(-1)).toBe(0x2001)
        expect(await simulated.get(genericPropertyRegistry.WhiteBalance)).toBe(4)

        const readOnly = await instance.send(
            genericOperationRegistry.SetDevicePropValue,
            { DevicePropCode: 0x5001 },
            Uint8Array.of(1)
        )
        expect(readOnly.code).toBe(0x200f)
        const unlisted = await instance.send(
            genericOperationRegistry.SetDevicePropValue,
            { DevicePropCode: 0x5005 },
            Uint8Array.of(3, 0)
        )
        expect(unlisted.code).toBe(0x201c)
        const unadvertised = await instance.send(genericOperationRegistry.GetDevicePropDesc, { DevicePropCode: 0x5010 })
        expect(unadvertised.code).toBe(0x200a)

        await new Promise(resolve => setTimeout(resolve, 5))
        expect(changed).toContainEqual(expect.objectContaining({ DevicePropCode: 0x5005 }))
    })

    it('reports advertised properties without descriptors as missing data rather than inventing them', async () => {
        const { camera: simulated, transport } = camera(fixture())
        await simulated.connect()
        await expect(simulated.get(genericPropertyRegistry.ExposureIndex)).rejects.toBeInstanceOf(
            ProfileDataMissingError
        )
        expect(transport.missingData).toHaveLength(1)
    })

    it('replays recorded exchanges in order, repeats the last, and delivers recorded events', async () => {
        const { camera: simulated, instance } = camera(fixture())
        await simulated.connect()
        const vendor = { ...genericOperationRegistry.GetDeviceInfo, code: 0x9001, name: 'Vendor', dataCodec: undefined }
        expect((await instance.send(vendor, {})).code).toBe(0x2001)
        expect((await instance.send(vendor, {})).code).toBe(0x2019)
        expect((await instance.send(vendor, {})).code).toBe(0x2019)

        const added = new Promise(resolve => simulated.on(genericEventRegistry.ObjectAdded, resolve))
        await simulated.captureImage({ includeInfo: false, includeData: false })
        await expect(added).resolves.toMatchObject({ ObjectHandle: 0x1234 })
    })

    it('answers OperationNotSupported only when the advertised operation list is complete', async () => {
        const complete = camera(fixture())
        await complete.camera.connect()
        expect((await complete.instance.send(genericOperationRegistry.GetStorageIDs, {})).code).toBe(0x2005)

        const partial = camera(fixture({ deviceInfo: { reportedIdentity: 'Fixture', source: 0 } }))
        await partial.transport.connect()
        await expect(partial.instance.send(genericOperationRegistry.GetStorageIDs, {})).rejects.toBeInstanceOf(
            ProfileDataMissingError
        )
    })

    it('applies quirk behaviours', async () => {
        const quirks: CameraProfile['quirks'] = [
            {
                id: 'busy',
                description: 'busy twice',
                source: 0,
                behaviour: { kind: 'device-busy', operation: '0x1001', times: 2 },
            },
            {
                id: 'session',
                description: 'id 1 only',
                source: 0,
                behaviour: { kind: 'session-id', rule: 'equals', sessionId: 1 },
            },
            {
                id: 'drop',
                description: 'drops USB',
                source: 0,
                behaviour: { kind: 'disconnect-on-request', operation: '0x9002', parameters: [] },
            },
            {
                id: 'datatype',
                description: 'uint32',
                source: 0,
                behaviour: { kind: 'property-datatype', property: '0x5001', dataType: '0x0006' },
            },
        ]
        const { instance, transport } = camera(fixture({ quirks }))
        await transport.connect()
        expect((await instance.send(genericOperationRegistry.OpenSession, { SessionID: 2 })).code).toBe(0x201d)
        expect((await instance.send(genericOperationRegistry.OpenSession, { SessionID: 1 })).code).toBe(0x2001)
        expect((await instance.send(genericOperationRegistry.GetDeviceInfo, {})).code).toBe(0x2019)
        expect((await instance.send(genericOperationRegistry.GetDeviceInfo, {})).code).toBe(0x2019)
        expect((await instance.send(genericOperationRegistry.GetDeviceInfo, {})).code).toBe(0x2001)

        const descriptor = await instance.send(genericOperationRegistry.GetDevicePropDesc, { DevicePropCode: 0x5001 })
        expect(descriptor.data).toMatchObject({ dataType: 0x0006, currentValueRaw: 64 })

        const vendor = { ...genericOperationRegistry.GetDeviceInfo, code: 0x9002, name: 'Drop', dataCodec: undefined }
        await expect(instance.send(vendor, {})).rejects.toBeInstanceOf(SimulatedDisconnectError)
        expect(transport.isConnected()).toBe(false)
    })

    it('rejects out-of-sequence transaction IDs under the strict-transaction-ids quirk', async () => {
        const profile = fixture({
            quirks: [{ id: 'strict', description: 'strict', source: 0, behaviour: { kind: 'strict-transaction-ids' } }],
        })
        const transport = new SimulatedTransport(profile)
        await transport.connect()
        const command = (transactionId: number) => {
            const bytes = new Uint8Array(12)
            const view = new DataView(bytes.buffer)
            view.setUint32(0, 12, true)
            view.setUint16(4, 1, true)
            view.setUint16(6, 0x1001, true)
            view.setUint32(8, transactionId, true)
            return bytes
        }
        const responseCode = async (transactionId: number) => {
            await transport.send(command(transactionId), 1, transactionId)
            let container = await transport.receive(512, 1, transactionId)
            if (new DataView(container.buffer).getUint16(4, true) === 2)
                container = await transport.receive(512, 1, transactionId)
            return new DataView(container.buffer).getUint16(6, true)
        }
        expect(await responseCode(1)).toBe(0x2001)
        expect(await responseCode(2)).toBe(0x2001)
        expect(await responseCode(5)).toBe(0x2004)
    })
    it('applies documented line quirks: gates, refusals, hidden codes, emitted events, polled delivery', async () => {
        const vendorOperation = (code: number, name: string) => ({
            ...genericOperationRegistry.GetDeviceInfo,
            code,
            name,
            dataCodec: undefined,
        })
        const profile = fixture({
            exchanges: [
                { operation: '0x9114', response: { code: '0x2001' }, source: 0 },
                { operation: '0x9128', response: { code: '0x2001' }, source: 0 },
                { operation: '0x100b', response: { code: '0x2001' }, source: 0 },
            ],
            quirks: [
                {
                    id: 'remote-mode',
                    description: 'gate',
                    source: 0,
                    behaviour: {
                        kind: 'requires-operations',
                        unlockedBy: ['0x9114'],
                        gated: { from: '0x9100', to: '0x91ff', except: ['0x9114'] },
                        response: '0x2019',
                    },
                },
                {
                    id: 'no-capture',
                    description: 'refuse',
                    source: 0,
                    behaviour: { kind: 'rejects-operations', operations: ['0x100e'], response: '0x2005' },
                },
                {
                    id: 'hidden',
                    description: 'hidden',
                    source: 0,
                    behaviour: { kind: 'hidden-from-device-info', operations: ['0x1016'] },
                },
                {
                    id: 'delete-event',
                    description: 'event',
                    source: 0,
                    behaviour: { kind: 'emit-event', afterOperation: '0x100b', event: '0x4003', copyParameters: true },
                },
                {
                    id: 'poll',
                    description: 'poll',
                    source: 0,
                    behaviour: {
                        kind: 'event-delivery',
                        mode: 'polled',
                        pollOperation: '0x9116',
                        emptyResponse: '0800000000000000',
                    },
                },
                {
                    id: 'ready',
                    description: 'busy',
                    source: 0,
                    behaviour: {
                        kind: 'device-busy',
                        operation: '0x90c8',
                        times: 1,
                        afterOperation: '0x9114',
                        response: '0xa102',
                    },
                },
            ],
        })
        const { camera: simulated, instance } = camera(profile)
        await simulated.connect()

        expect((await instance.send(vendorOperation(0x9128, 'Release'), {})).code).toBe(0x2019)
        expect((await instance.send(vendorOperation(0x9114, 'RemoteMode'), {})).code).toBe(0x2001)
        expect((await instance.send(vendorOperation(0x9128, 'Release'), {})).code).toBe(0x2001)
        expect((await instance.send(vendorOperation(0x90c8, 'DeviceReady'), {})).code).toBe(0xa102)
        // After the busy window the fixture's complete operation list decides: 0x90c8 is not advertised.
        expect((await instance.send(vendorOperation(0x90c8, 'DeviceReady'), {})).code).toBe(0x2005)

        const poll = await instance.send(vendorOperation(0x9116, 'GetEvent'), {})
        expect(poll).toMatchObject({ code: 0x2001, data: Uint8Array.of(8, 0, 0, 0, 0, 0, 0, 0) })
        expect((await instance.send(genericOperationRegistry.InitiateCapture, {})).code).toBe(0x2005)

        const deviceInfo = await instance.send(genericOperationRegistry.GetDeviceInfo, {})
        expect(deviceInfo.data?.operationsSupportedRaw).not.toContain(0x1016)

        const removed = new Promise(resolve => simulated.on(genericEventRegistry.ObjectRemoved, resolve))
        await instance.send(genericOperationRegistry.DeleteObject, { ObjectHandle: 0x77 })
        await expect(removed).resolves.toMatchObject({ ObjectHandle: 0x77 })
    })
})
