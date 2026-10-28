import { Camera } from '@camera/index'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { validateCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { ChaosDisconnectError } from '@transport/simulated/chaos-faults'
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
    simulated.getInstance().configureTransactions({ deviceBusyRetries: 0 })
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
        // Observe the quirk's raw answers: switch off darkgrade's DeviceBusy retry where the library has one.
        const tunable = instance as { configureTransactions?: (policy: { deviceBusyRetries: number }) => void }
        tunable.configureTransactions?.({ deviceBusyRetries: 0 })
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

        const removed: unknown[] = []
        simulated.on(genericEventRegistry.ObjectRemoved, event => removed.push(event))
        await instance.send(genericOperationRegistry.DeleteObject, { ObjectHandle: 0x77 })
        await new Promise(resolve => setTimeout(resolve, 1))
        expect(removed).toEqual([])
        await expect(instance.send(vendorOperation(0x9116, 'GetEvent'), {})).rejects.toBeInstanceOf(
            ProfileDataMissingError
        )
    })
})

/** Independent USB container construction: does not reuse simulator dataset encoders. */
function wireContainer(
    type: number,
    operation: number,
    transactionId: number,
    parameters: number[] = [],
    payload?: Uint8Array
): Uint8Array {
    const bytes = new Uint8Array(12 + parameters.length * 4 + (payload?.length ?? 0))
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, operation, true)
    view.setUint32(8, transactionId, true)
    parameters.forEach((parameter, index) => view.setUint32(12 + index * 4, parameter, true))
    if (payload) bytes.set(payload, 12 + parameters.length * 4)
    return bytes
}

async function wireRequest(
    transport: SimulatedTransport,
    operation: number,
    transactionId: number,
    parameters: number[] = [],
    payload?: Uint8Array
) {
    await transport.send(wireContainer(1, operation, transactionId, parameters), 1, transactionId)
    if (payload) await transport.send(wireContainer(2, operation, transactionId, [], payload), 1, transactionId)
    let bytes = await transport.receive(256 * 1024, 1, transactionId)
    let data: Uint8Array | undefined
    if (new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true) === 2) {
        data = bytes.slice(12)
        bytes = await transport.receive(512, 1, transactionId)
    }
    return { code: new DataView(bytes.buffer, bytes.byteOffset).getUint16(6, true), data }
}

describe('simulator protocol and state regressions', () => {
    it('rejects out-of-range, off-step and malformed-width writes without changing readback', async () => {
        const transport = new SimulatedTransport(
            fixture({
                properties: [
                    {
                        code: '0x500f',
                        source: 0,
                        descriptor: {
                            dataType: '0x0003',
                            writable: true,
                            factoryDefault: 0,
                            current: 0,
                            form: { range: { minimum: -20, maximum: 20, step: 5 } },
                        },
                    },
                ],
            })
        )
        await transport.connect()
        for (const [index, bytes] of [
            Uint8Array.of(4, 0),
            Uint8Array.of(21, 0),
            Uint8Array.of(0xeb, 0xff),
            Uint8Array.of(5),
            Uint8Array.of(5, 0, 0),
        ].entries()) {
            expect((await wireRequest(transport, 0x1016, index + 1, [0x500f], bytes)).code).toBe(0x201c)
        }
        expect((await wireRequest(transport, 0x1016, 7, [0x500f], Uint8Array.of(0xf1, 0xff))).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1015, 8, [0x500f])).data).toEqual(Uint8Array.of(0xf1, 0xff))
    })

    it('does not let wildcard captures mask rejected writes or stale recorded reads after a write', async () => {
        const transport = new SimulatedTransport(
            fixture({
                exchanges: [
                    {
                        operation: '0x1015',
                        parameters: ['0x5005'],
                        response: { code: '0x2001', data: '0200' },
                        source: 0,
                    },
                    { operation: '0x1016', parameters: ['0x5005'], response: { code: '0x2001' }, source: 0 },
                    {
                        operation: '0x1016',
                        parameters: ['0x5005'],
                        dataFromHost: '0200',
                        response: { code: '0x2019' },
                        source: 0,
                    },
                ],
            })
        )
        await transport.connect()
        expect((await wireRequest(transport, 0x1015, 1, [0x5005])).data).toEqual(Uint8Array.of(2, 0))
        expect((await wireRequest(transport, 0x1016, 2, [0x5005], Uint8Array.of(3, 0))).code).toBe(0x201c)
        expect((await wireRequest(transport, 0x1016, 3, [0x5005], Uint8Array.of(4, 0))).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1015, 4, [0x5005])).data).toEqual(Uint8Array.of(4, 0))
        expect((await wireRequest(transport, 0x1016, 5, [0x5005], Uint8Array.of(2, 0))).code).toBe(0x2019)
        expect((await wireRequest(transport, 0x1015, 6, [0x5005])).data).toEqual(Uint8Array.of(4, 0))
    })

    it('requires payload evidence for a recorded write without a descriptor and preserves exact successful values', async () => {
        const profile = fixture({
            properties: [],
            deviceInfo: undefined,
            exchanges: [
                { operation: '0x1016', parameters: ['0x5005'], response: { code: '0x2001' }, source: 0 },
                {
                    operation: '0x1016',
                    parameters: ['0x5005'],
                    dataFromHost: '0400',
                    response: { code: '0x2001' },
                    source: 0,
                },
            ],
        })
        const transport = new SimulatedTransport(profile)
        await transport.connect()
        await expect(wireRequest(transport, 0x1016, 1, [0x5005], Uint8Array.of(2, 0))).rejects.toBeInstanceOf(
            ProfileDataMissingError
        )
        expect((await wireRequest(transport, 0x1016, 2, [0x5005], Uint8Array.of(4, 0))).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1015, 3, [0x5005])).data).toEqual(Uint8Array.of(4, 0))
    })

    it('enforces known session state despite recorded OK replies, resetting traces without resetting camera settings', async () => {
        const transport = new SimulatedTransport(
            fixture({
                exchanges: [
                    { operation: '0x1002', parameters: ['0x1'], response: { code: '0x2001' }, source: 0 },
                    { operation: '0x9001', parameters: [], response: { code: '0x2019' }, source: 0 },
                    { operation: '0x9001', parameters: [], response: { code: '0x2001' }, source: 0 },
                ],
            })
        )
        await transport.connect()
        expect((await wireRequest(transport, 0x1002, 1, [0])).code).toBe(0x201d)
        expect((await wireRequest(transport, 0x1002, 2, [1])).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1002, 3, [1])).code).toBe(0x201e)
        expect((await wireRequest(transport, 0x9001, 4)).code).toBe(0x2019)
        expect((await wireRequest(transport, 0x9001, 5)).code).toBe(0x2001)
        await wireRequest(transport, 0x1016, 6, [0x5005], Uint8Array.of(4, 0))
        await wireRequest(transport, 0x1003, 7)
        expect((await wireRequest(transport, 0x1015, 70, [0x5005])).code).toBe(0x2003)
        expect((await wireRequest(transport, 0x1002, 8, [1])).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x9001, 9)).code).toBe(0x2019)
        expect((await wireRequest(transport, 0x1015, 10, [0x5005])).data).toEqual(Uint8Array.of(4, 0))
        await transport.classRequestReset()
        expect((await wireRequest(transport, 0x1002, 11, [1])).code).toBe(0x2001)
        await transport.disconnect()
        await transport.connect()
        expect((await wireRequest(transport, 0x9001, 12)).code).toBe(0x2019)
    })

    it('keeps hidden-but-implemented codes unknown instead of using advertised-list absence as rejection evidence', async () => {
        const transport = new SimulatedTransport(
            fixture({
                exchanges: [],
                quirks: [
                    {
                        id: 'hidden',
                        source: 0,
                        description: 'known hidden codes',
                        behaviour: {
                            kind: 'hidden-from-device-info',
                            operations: ['0x9001'],
                            properties: ['0x5010'],
                        },
                    },
                ],
            })
        )
        await transport.connect()
        await expect(wireRequest(transport, 0x9001, 1)).rejects.toBeInstanceOf(ProfileDataMissingError)
        await expect(wireRequest(transport, 0x1015, 2, [0x5010])).rejects.toBeInstanceOf(ProfileDataMissingError)
        expect((await wireRequest(transport, 0x9002, 3)).code).toBe(0x2005)
        expect((await wireRequest(transport, 0x1015, 4, [0x5011])).code).toBe(0x200a)
    })

    it('does not execute quirks whose source marks them unverified', async () => {
        const transport = new SimulatedTransport(
            fixture({
                quirks: [
                    {
                        id: 'unconfirmed',
                        source: 0,
                        description: 'reference only',
                        unverified: true,
                        behaviour: { kind: 'rejects-operations', operations: ['0x100e'], response: '0x2005' },
                    },
                ],
            })
        )
        await transport.connect()
        expect((await wireRequest(transport, 0x100e, 1, [0, 0])).code).toBe(0x2001)
    })

    it('rejects malformed or overlapping containers while preserving the pending command', async () => {
        const transport = new SimulatedTransport(fixture())
        await transport.connect()
        await expect(transport.send(Uint8Array.of(1), 1, 1)).rejects.toThrow('Truncated PTP container')
        const wrongLength = wireContainer(1, 0x1001, 1)
        wrongLength[0]++
        await expect(transport.send(wrongLength, 1, 1)).rejects.toThrow('length')
        await expect(transport.send(wireContainer(1, 0x1001, 1, [], Uint8Array.of(0)), 1, 1)).rejects.toThrow('UINT32')
        await expect(transport.send(wireContainer(1, 0x1001, 1, [1, 2, 3, 4, 5, 6]), 1, 1)).rejects.toThrow('five')
        await transport.send(wireContainer(1, 0x1016, 2, [0x5005]), 1, 2)
        await expect(transport.send(wireContainer(1, 0x1001, 3), 1, 3)).rejects.toThrow('not been drained')
        await expect(transport.send(wireContainer(2, 0x9999, 2, [], Uint8Array.of(4, 0)), 1, 2)).rejects.toThrow(
            'operation'
        )
        await transport.send(wireContainer(2, 0x1016, 2, [], Uint8Array.of(4, 0)), 1, 2)
        await expect(transport.send(wireContainer(2, 0x1016, 2, [], Uint8Array.of(2, 0)), 1, 2)).rejects.toThrow(
            'Duplicate'
        )
        expect(new DataView((await transport.receive(512, 1, 2)).buffer).getUint16(6, true)).toBe(0x2001)
    })

    it('honors receive buffer sizes and resumes a data container before delivering its response', async () => {
        const transport = new SimulatedTransport(
            fixture({
                exchanges: [
                    {
                        operation: '0x9002',
                        parameters: [],
                        source: 0,
                        response: { code: '0x2001', data: 'ab'.repeat(30) },
                    },
                ],
            })
        )
        await transport.connect()
        await transport.send(wireContainer(1, 0x9002, 1), 1, 1)
        await expect(transport.receive(0, 1, 1)).rejects.toThrow('positive')
        const chunks = [
            await transport.receive(16, 1, 1),
            await transport.receive(16, 1, 1),
            await transport.receive(16, 1, 1),
        ]
        expect(chunks.map(bytes => bytes.length)).toEqual([16, 16, 10])
        const response = await transport.receive(16, 1, 1)
        expect(response.length).toBe(12)
        expect(new DataView(response.buffer).getUint16(6, true)).toBe(0x2001)
    })

    it('does not deliver an old connection event into a newly connected session', async () => {
        const transport = new SimulatedTransport(fixture())
        const received: number[] = []
        transport.on(event => received.push(event.code))
        await transport.connect()
        await wireRequest(transport, 0x1016, 1, [0x5005], Uint8Array.of(4, 0))
        await transport.disconnect()
        await transport.connect()
        await new Promise(resolve => setTimeout(resolve, 1))
        expect(received).toEqual([])
        await wireRequest(transport, 0x1002, 20, [1])
        await wireRequest(transport, 0x1016, 2, [0x5005], Uint8Array.of(2, 0))
        await new Promise(resolve => setTimeout(resolve, 1))
        expect(received).toEqual([0x4006])
    })

    it('counts valid transaction IDs even when session or parameter validation returns an error', async () => {
        const transport = new SimulatedTransport(
            fixture({
                quirks: [
                    {
                        id: 'strict',
                        source: 0,
                        description: 'strict IDs',
                        behaviour: { kind: 'strict-transaction-ids' },
                    },
                ],
            })
        )
        await transport.connect()
        expect((await wireRequest(transport, 0x1002, 1, [1])).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1002, 2, [1])).code).toBe(0x201e)
        expect((await wireRequest(transport, 0x1001, 3, [7])).code).toBe(0x201d)
        expect((await wireRequest(transport, 0x1001, 4)).code).toBe(0x2001)
    })

    it('keeps strict transaction ordering after a busy reply and does not advance it for a rejected ID', async () => {
        const transport = new SimulatedTransport(
            fixture({
                quirks: [
                    {
                        id: 'busy',
                        source: 0,
                        description: 'busy first',
                        behaviour: { kind: 'device-busy', operation: '0x1001', times: 1 },
                    },
                    { id: 'strict', source: 0, description: 'strict', behaviour: { kind: 'strict-transaction-ids' } },
                ],
            })
        )
        await transport.connect()
        expect((await wireRequest(transport, 0x1001, 1)).code).toBe(0x2019)
        expect((await wireRequest(transport, 0x1001, 2)).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1001, 8)).code).toBe(0x2004)
        expect((await wireRequest(transport, 0x1001, 3)).code).toBe(0x2001)
    })
})

describe('chaos and protocol-state integration', () => {
    it('emits a successful write once after updating state, with listener failures retained', async () => {
        const transport = new SimulatedTransport(fixture(), {
            chaos: { seed: 1, faults: ['events-out-of-order'], probability: 0 },
        })
        const events: number[] = []
        transport.on(event => events.push(event.code))
        transport.on(() => {
            throw new Error('listener fixture error')
        })
        await transport.connect()
        await wireRequest(transport, 0x1016, 1, [0x5005], Uint8Array.of(4, 0))
        await new Promise(resolve => setTimeout(resolve, 1))
        expect(events).toEqual([0x4006])
        expect(transport.eventHandlerErrors).toHaveLength(1)
        expect((await wireRequest(transport, 0x1015, 2, [0x5005])).data).toEqual(Uint8Array.of(4, 0))
    })

    it('releases a fault-stalled read on an explicit reset and preserves normal session rules afterward', async () => {
        const transport = new SimulatedTransport(fixture(), { chaos: { seed: 1, faults: ['stall'], probability: 1 } })
        await transport.connect()
        const pending = wireRequest(transport, 0x1001, 1)
        const rejected = expect(pending).rejects.toThrow('cancelled by a device reset')
        await new Promise(resolve => setTimeout(resolve, 1))
        await transport.classRequestReset()
        await rejected
        if (!transport.chaos) throw new Error('Missing fault injector')
        transport.chaos.enabled = false
        expect((await wireRequest(transport, 0x1015, 2, [0x5005])).code).toBe(0x2003)
        expect((await wireRequest(transport, 0x1002, 3, [1])).code).toBe(0x2001)
        expect((await wireRequest(transport, 0x1015, 4, [0x5005])).data).toEqual(Uint8Array.of(2, 0))
    })

    it('reports an immediate chaos disconnect without issuing a zero-length receive', async () => {
        const transport = new SimulatedTransport(fixture(), {
            chaos: { seed: 1, faults: ['disconnect-mid-transaction'], probability: 1 },
        })
        await transport.connect()
        await expect(wireRequest(transport, 0x1002, 1, [1])).rejects.toBeInstanceOf(ChaosDisconnectError)
        expect(transport.isConnected()).toBe(false)
    })
})
