import { configureSlateTelemetry, slateTelemetry } from '@core/telemetry'
import { sdkTelemetry } from '@vendors/sony/sdk-telemetry'
import { createApplicationDiagnostics } from '@contribute/application'
import { redactMessage, validateContribution } from '@contribute/schema'
import { runOperation } from '@runtime/operations'
import { afterEach, expect, test, vi } from 'vitest'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { Logger } from '@core/logger'
import { ObjectInfoCodec } from '@ptp/datasets/object-info-dataset'
import { concatenate, encodedDeviceInfo, encodedObjectInfo } from '@tests/fixtures/camera-fixtures'
import { answeringTransport, ptpContainer, type SentContainer } from '@tests/fixtures/ptp-wire'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { protocolEvidence, requestEvidence } from '@vendors/protocol-evidence'
import { createNikonRegistry, createPTPRegistry, createSonyRegistry } from '@vendors/registry'

afterEach(() => {
    configureSlateTelemetry(undefined)
    vi.unstubAllGlobals()
})

/** A configured diagnostics client at a fixed revision that keeps each local record in `saved`. */
async function telemetryClient(options: Partial<Parameters<typeof createApplicationDiagnostics>[0]> = {}) {
    vi.stubGlobal('__SLATE_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__SLATE_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
        ...options,
    })
    configureSlateTelemetry(client)
    return { client, saved }
}

test('discarding a driver detaches telemetry without closing USB or stealing the replacement listener', async () => {
    const { client, saved } = await telemetryClient()
    let handler: ((event: PTPEvent) => void) | undefined
    const disconnect = vi.fn(async () => {})
    const source = { getType: () => 'usb', isConnected: () => true, disconnect,
        on: (listener: typeof handler) => { handler = listener },
        off: (listener: typeof handler) => { if (handler === listener) handler = undefined },
    } as unknown as TransportInterface
    const previous = slateTelemetry(source), old = vi.fn(), current = slateTelemetry(source), next = vi.fn()
    try {
        previous.transport.on?.(old)
        await previous.identify({ manufacturer: 'Unknown', model: 'Unknown', deviceVersion: 'unknown' })
        previous.detach()
        current.transport.on?.(next)
        await current.identify({ manufacturer: 'Sony', model: 'ILCE-6700', deviceVersion: '1' })
        previous.detach() // A stale owner must not remove the replacement's handler.
        handler?.({ code: 0x4002, parameters: [1], transactionId: 0 })
        expect(old).not.toHaveBeenCalled()
        expect(next).toHaveBeenCalledOnce()
        // The connection was open before either observer: one marker, then the event, in one session.
        expect(saved.map(item => item.entry.kind)).toEqual(['attach', 'event'])
        expect(disconnect).not.toHaveBeenCalled()
    } finally { current.detach(); client.close() }
})

test('property-write diagnostics preserve each transaction and distinguish a rejected request from readback', async () => {
    const { client, saved } = await telemetryClient()
    const observer = slateTelemetry({ getType: () => 'usb', on: () => {} } as any)
    try {
        await observer.identify({ manufacturer: 'Canon', model: 'Test', deviceVersion: '1' })
        for (const [transactionId, response] of [[23, 0x2019], [24, 0x2001]]) {
            observer.protocol({
                type: 'property-write', vendorId: 0x04a9, property: 0xd1b8,
                dataType: 6, requested: 4, transactionId, outcome: 'response', response,
            }, 0x9110)
        }
        const entries = saved.map(item => item.entry)
        expect(entries).toHaveLength(2)
        expect(entries[0]).toMatchObject({ failed: true, kind: 'command', direction: 'out', transactionId: 23 })
        expect(entries[1]).toMatchObject({ failed: false, transactionId: 24 })
        expect(entries[0].protocol).not.toHaveProperty('current')
        expect(entries.every(entry => entry.sessionId === entries[0].sessionId)).toBe(true)
    } finally { client.close() }
})

test('telemetry retains the native single event handler across attachment, reconnect and identity changes', async () => {
    const entries: any[] = []
    const contexts: any[] = []
    const { client } = await telemetryClient({
        localRecord: (context, entry) => {
            contexts.push(context)
            entries.push(entry)
        },
    })
    let handler: ((value: any) => void) | undefined
    const source = {
        connect: vi.fn(async () => {}),
        disconnect: vi.fn(async () => {
            handler = undefined
        }),
        send: vi.fn(async () => {}),
        receive: vi.fn(async () => new Uint8Array(12)),
        classRequestReset: vi.fn(async () => {
            handler = undefined
        }),
        resetPort: vi.fn(async () => {}),
        on: (next: any) => {
            handler = next
        },
        off: () => {
            handler = undefined
        },
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => 'usb' as any,
    }
    const wrapped = slateTelemetry(source)
    const events = vi.fn()
    wrapped.transport.on!(events)
    const event = { code: 0x4002, transactionId: 7, parameters: [123] }
    handler!(event)
    try {
        await wrapped.identify({ manufacturer: 'Canon', model: 'EOS 90D', deviceVersion: '1.0' })
        handler!(event)
        expect(events).toHaveBeenCalledTimes(2)
        expect(entries.filter(entry => entry.kind === 'event')).toHaveLength(1)
        expect(contexts[0]).toMatchObject({ evidence: 'synthetic', firmware: '1.0' })
        await wrapped.transport.classRequestReset()
        handler!(event)
        expect(events).toHaveBeenCalledTimes(3)
        await wrapped.identify({ manufacturer: 'Canon', model: 'EOS 70D', deviceVersion: '1.1' })
        handler!(event)
        expect(events).toHaveBeenCalledTimes(4)
        expect(contexts.at(-1).model).toBe('EOS 70D')
        expect(new Set(entries.map(entry => entry.sessionId)).size).toBe(1)
        const previousSession = entries.at(-1).sessionId
        await wrapped.transport.disconnect()
        await wrapped.transport.connect()
        wrapped.transport.on!(events)
        handler!(event)
        expect(events).toHaveBeenCalledTimes(5)
        expect(entries.at(-1).sessionId).not.toBe(previousSession)
        await wrapped.transport.resetPort!()
        expect(source.resetPort).toHaveBeenCalledTimes(1)
        expect(source.connect).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(entries)).not.toContain('parameters')
        await wrapped.identify({ manufacturer: 'Canon', model: 'invalid\nidentity', deviceVersion: '1' })
        handler!(event)
        expect(events).toHaveBeenCalledTimes(6)
    } finally {
        client.close()
    }
})

test('custom transports do not initialize hardware telemetry without explicit configuration', async () => {
    const source = { getType: () => 'usb', on: vi.fn() } as any
    await slateTelemetry(source).identify({ manufacturer: 'Canon', model: 'EOS 90D', deviceVersion: '1' })
    expect(source.on).not.toHaveBeenCalled()
})

test('SDK telemetry preserves outcomes and profile scoping without passwords, paths, arguments or response payloads', async () => {
    const { client, saved } = await telemetryClient()
    try {
        const sdk = sdkTelemetry('synthetic')
        await sdk.operation({ cmd: 'connect_wifi', model: 'ILME-FX2', password: 'SECRET' }, async () => ({
            ok: true,
            payload: 'PRIVATE',
        }))
        await expect(
            sdk.operation({ cmd: 'download_content', path: '/private/user/file' }, async () => {
                throw new Error('PRIVATE error')
            })
        ).rejects.toThrow('PRIVATE error')
        expect(saved[0].camera).toMatchObject({
            model: 'ILME-FX2',
            firmware: 'unknown',
            transport: 'wifi', backend: 'vendor-api',
            evidence: 'synthetic',
        })
        expect(saved[1].entry).toMatchObject({ operation: 'download_content', failed: true })
        expect(JSON.stringify(saved)).not.toMatch(/SECRET|PRIVATE|password|payload|\/private/)
        await sdk.operation({ cmd: 'connect', serial: 'PRIVATE' }, async () => ({ ok: true }))
        expect(saved.at(-1).camera).toMatchObject({ model: 'Unknown', transport: 'usb' })
        expect(saved.at(-1).entry.sessionId).not.toBe(saved[0].entry.sessionId)
        await expect(
            sdk.operation({ cmd: 'connect_wifi', model: 'ILCE-6700' }, async () => {
                throw new Error('Connection failed')
            })
        ).rejects.toThrow('Connection failed')
        // A failed attempt is still about the body the caller named; a name that is not a Sony body stays unidentified.
        expect(saved.at(-1).camera).toMatchObject({ model: 'ILCE-6700', transport: 'wifi', backend: 'vendor-api' })
        expect(saved.at(-1).entry.failed).toBe(true)
        // The trust step that starts a Wi-Fi connection shares the session of the connect that follows.
        await sdk.operation({ cmd: 'fingerprint', model: 'ILME-FX2', ip: 'PRIVATE' }, async () => ({ ok: true, fingerprint: 'PRIVATE' }))
        const trust = saved.at(-1)
        await sdk.operation({ cmd: 'connect_wifi', model: 'ILME-FX2' }, async () => ({ ok: true }))
        expect(trust.camera).toMatchObject({ model: 'ILME-FX2', transport: 'wifi' })
        expect(saved.at(-1).entry.sessionId).toBe(trust.entry.sessionId)
        // An unvalidated Sony body is still attempted, so it carries the name the caller gave.
        await sdk.operation({ cmd: 'connect_bluetooth_direct', model: 'ILCE-7M4' }, async () => ({ ok: true }))
        expect(saved.at(-1).camera).toMatchObject({ model: 'ILCE-7M4', transport: 'wifi' })
        await sdk.operation({ cmd: 'fingerprint', model: 'private-name' }, async () => ({ ok: true }))
        expect(saved.at(-1).camera.model).toBe('Unknown')
        expect(saved.at(-1).entry.sessionId).not.toBe(trust.entry.sessionId)
    } finally {
        client.close()
    }
})

test('direct source execution attributes SDK observations to its checkout without changing success or failure', async () => {
    const { execFileSync } = await import('node:child_process')
    const expectedRevision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const contexts: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: camera => contexts.push(camera),
    })
    configureSlateTelemetry(client)
    try {
        const observer = sdkTelemetry('synthetic')
        await expect(observer.operation({ cmd: 'properties' }, async () => ({ value: 42 }))).resolves.toEqual({
            value: 42,
        })
        await expect(
            observer.operation({ cmd: 'capture' }, async () => {
                throw new Error('camera failure')
            })
        ).rejects.toThrow('camera failure')
        expect(contexts).toHaveLength(2)
        expect(contexts.every(camera => camera.revision === expectedRevision && camera.evidence === 'synthetic')).toBe(
            true
        )
    } finally {
        client.close()
    }
})

test('video workflow markers retain the wire session and SDK USB model without storing command parameters', async () => {
    const { client, saved } = await telemetryClient()
    try {
        const source = { on: () => {}, off: () => {}, getType: () => 'usb', isLittleEndian: () => true } as any
        const wrapped = slateTelemetry(source)
        await wrapped.identify({ manufacturer: 'Nikon', model: 'Z5_2', deviceVersion: 'V1.00' })
        await wrapped.operation('record_start', async () => 42)
        await expect(
            wrapped.operation('record_stop', async () => {
                throw new Error('Original stop error')
            })
        ).rejects.toThrow('Original stop error')
        expect(saved[0].entry).toMatchObject({ operation: 'record_start', failed: false })
        expect(saved[1].entry).toMatchObject({
            operation: 'record_stop',
            failed: true,
            sessionId: saved[0].entry.sessionId,
        })
        const sdk = sdkTelemetry('synthetic')
        await sdk.operation({ cmd: 'connect', serial: 'PRIVATE' }, async () => ({
            ok: true,
            model: 'ILCE-6700',
            handle: 'PRIVATE',
        }))
        await sdk.operation({ cmd: 'command', id: '1', param: '1' }, async () => ({ ok: true }))
        expect(saved.at(-1)).toMatchObject({
            camera: { model: 'ILCE-6700', transport: 'usb' },
            entry: { operation: 'record_start' },
        })
        await sdk.operation({ cmd: 'command', id: '1', param: '0' }, async () => ({ ok: true }))
        expect(saved.at(-1).entry.operation).toBe('record_stop')
        await sdk.operation({ cmd: 'connect', serial: 'PRIVATE' }, async () => ({ ok: true, model: 'private/path' }))
        expect(saved.at(-1).camera.model).toBe('Unknown')
        expect(JSON.stringify(saved)).not.toMatch(/PRIVATE|private\/path|handle|param/)
    } finally {
        client.close()
    }
})

test('failed connections are recorded unidentified, and hardware fingerprints track a body without raw serials and are cleared before a failed reconnect', async () => {
    const { client, saved } = await telemetryClient()
    const source = {
        telemetryEvidence: 'hardware',
        getType: () => 'usb',
        on: () => {},
        off: () => {},
        isConnected: () => false,
        connect: async () => {
            throw Error('Unplugged')
        },
        isLittleEndian: () => true,
    } as any
    const wrapped = slateTelemetry(source)
    try {
        // A connection that fails before any identity read is still recorded, as an unknown body.
        await wrapped.prepare()
        await expect(wrapped.transport.connect()).rejects.toThrow('Unplugged')
        expect(saved[0]).toMatchObject({ camera: { model: 'Unknown' }, entry: { kind: 'connect', failed: true } })
        const camera = { manufacturer: 'Nikon', model: 'Z5_2', deviceVersion: '1', serialNumber: 'PRIVATE-SERIAL-123' }
        await wrapped.identify(camera)
        await wrapped.operation('record_start', async () => 42)
        const fingerprint = saved.at(-1).camera.hardwareFingerprint
        expect(fingerprint).toMatch(/^camera-v1:[a-f0-9]{64}$/)
        await wrapped.identify({ ...camera, deviceVersion: '2' })
        await wrapped.operation('record_stop', async () => 42)
        expect(saved.at(-1).camera.hardwareFingerprint).toBe(fingerprint)
        await expect(wrapped.transport.connect()).rejects.toThrow('Unplugged')
        expect(saved.at(-1).camera).toMatchObject({ model: 'Unknown' })
        expect(saved.at(-1).camera.hardwareFingerprint).toBeUndefined()
        await wrapped.identify({ ...camera, serialNumber: 'PRIVATE-SERIAL-456' })
        await wrapped.operation('record_start', async () => 42)
        expect(saved.at(-1).camera.hardwareFingerprint).not.toBe(fingerprint)
        expect(JSON.stringify(saved)).not.toContain('PRIVATE-SERIAL')
    } finally {
        client.close()
    }
})

test('Sony USB SDK fingerprints require an acknowledged serial selection, and wireless reconnect clears them', async () => {
    const { client, saved } = await telemetryClient()
    try {
        const sdk = sdkTelemetry('hardware')
        await sdk.operation({ cmd: 'connect', serial: 'PRIVATE-123' }, async () => ({ ok: true, model: 'ILME-FX2' }))
        expect(saved.at(-1).camera.hardwareFingerprint).toMatch(/^camera-v1:[a-f0-9]{64}$/)
        await sdk.operation({ cmd: 'properties' }, async () => ({ ok: true }))
        expect(saved.at(-1).camera.hardwareFingerprint).toBe(saved[0].camera.hardwareFingerprint)
        await sdk.operation({ cmd: 'connect_wifi', model: 'ILME-FX2' }, async () => ({ ok: true }))
        expect(saved.at(-1).camera.hardwareFingerprint).toBeUndefined()
        expect(JSON.stringify(saved)).not.toContain('PRIVATE-123')
    } finally {
        client.close()
    }
})

test('facts already reported for an identified body are not re-sent on every connection', async () => {
    const { GenericCamera } = await import('@vendors/generic/generic-camera')
    const { resetReportedFacts } = await import('@core/telemetry')
    const { Logger } = await import('@core/logger')
    resetReportedFacts()
    const { client } = await telemetryClient()
    try {
        let connected = false
        const source = {
            getType: () => 'usb', isLittleEndian: () => true, isConnected: () => connected, on: () => {}, off: () => {},
            connect: async () => { connected = true }, disconnect: async () => { connected = false },
            send: async () => {}, receive: async () => new Uint8Array(12), classRequestReset: async () => {},
        } as any
        const camera = new GenericCamera(source, new Logger({ captureConsole: false, renderInTerminal: false }))
        const telemetry = (camera as any).telemetry
        const identity = { manufacturer: 'Sony Corporation', model: 'ILCE-6700', deviceVersion: '2.00' }
        const queued = () => (client as any).status().queuedEntries
        for (let connection = 0; connection < 3; connection++) {
            await telemetry.prepare()
            await telemetry.transport.connect()
            await telemetry.transport.send(new Uint8Array(12), 1, 1)
            const before = queued()
            await telemetry.identify(identity)
            // The same inventory is advertised on every connection.
            for (const code of [0x9201, 0x9202, 0x9209])
                camera.recordProtocol({ type: 'unknown', vendorId: 0x054c, category: 'operation', code, advertised: true }, 0x1001)
            expect(queued() - before).toBe(connection === 0 ? 3 : 0)
            ;(camera as any).protocolSeen.clear()
            await telemetry.transport.disconnect()
        }
        // A discovery probe reports the same code under another vendor scope: once, without
        // making the vendor session's copy look new again.
        await telemetry.identify(identity)
        const mixed = queued()
        for (const vendorId of [0, 0x054c, 0, 0x054c])
            camera.recordProtocol({ type: 'unknown', vendorId, category: 'operation', code: 0x9201, advertised: true }, 0x1001)
        expect(queued() - mixed).toBe(1)
        ;(camera as any).protocolSeen.clear()
        // A Canon setting's value and its allowed values arrive as separate events for the same
        // property, and two operations list the same inventory category: none of them may make
        // another look new on the next connection.
        const facts = () => {
            camera.recordProtocol({ type: 'property-value', vendorId: 0x04a9, property: 0xd103, dataType: 6, current: 100 }, 0x9116)
            camera.recordProtocol({ type: 'property-value', vendorId: 0x04a9, property: 0xd103, dataType: 6, values: [100, 200] }, 0x9116)
            camera.recordProtocol({ type: 'inventory', vendorId: 0x054c, category: 'property', codes: [0x5007] }, 0x1001)
            camera.recordProtocol({ type: 'inventory', vendorId: 0x054c, category: 'property', codes: [0x5007, 0xd200] }, 0x9209)
        }
        const paired = queued()
        facts()
        expect(queued() - paired).toBe(4)
        ;(camera as any).protocolSeen.clear()
        facts()
        expect(queued() - paired).toBe(4)
        ;(camera as any).protocolSeen.clear()
        // A changed value is still reported, as is a benchmark's own complete profile.
        const before = queued()
        await telemetry.identify(identity)
        camera.recordProtocol({ type: 'unknown', vendorId: 0x054c, category: 'operation', code: 0x9201, advertised: false }, 0x1001)
        expect(queued() - before).toBe(1)
    } finally { client.close() }
})

test('a connection that fails before any identity read is attributed to the camera last seen at that USB identity', async () => {
    const { configureKnownCameras } = await import('@core/telemetry')
    const remembered = new Map<string, any>()
    const key = (usb: any) => `${usb.vendorId}:${usb.productId}:${usb.serialNumber ?? ''}`
    configureKnownCameras({ lookup: usb => remembered.get(key(usb)), remember: (usb, camera) => void remembered.set(key(usb), camera) })
    const batches: any[] = []
    const { client } = await telemetryClient({
        fetch: async (_url, init) => {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            if (body.contributions) batches.push(body)
            return Response.json(body.installKey ? { installKey: body.installKey, noticeVersion: body.noticeVersion } : {}, { status: body.contributions ? 202 : 200 })
        },
    })
    try {
        let asleep = false
        const source = { telemetryEvidence: 'hardware', getType: () => 'usb', isLittleEndian: () => true, isConnected: () => false, on: () => {}, off: () => {},
            connect: async () => { if (asleep) throw new Error('No USB devices available') }, disconnect: async () => {},
            send: async () => {}, receive: async () => new Uint8Array(12), classRequestReset: async () => {} } as any
        const wrapped = slateTelemetry(source)
        const byModel = { usb: { filters: [{ vendorId: 0x04a9, productId: 0x3329 }] } }
        const bySerial = { usb: { filters: [{ vendorId: 0x054c, productId: 0x0e78, serialNumber: 'PRIVATE-SERIAL' }] } }
        const neverSeen = { usb: { filters: [{ vendorId: 0x04b0, productId: 0x0454 }] } }
        await wrapped.transport.connect(byModel as any)
        await wrapped.identify({ manufacturer: 'Canon.Inc', model: 'Canon EOS R8 Mark II', deviceVersion: '3-1.0.0', serialNumber: 'PRIVATE-CANON' })
        await wrapped.transport.connect(bySerial as any)
        await wrapped.identify({ manufacturer: 'Sony Corporation', model: 'ILCE-6700', deviceVersion: '2.00', serialNumber: 'PRIVATE-SERIAL' })
        expect(JSON.stringify([...remembered])).not.toMatch(/PRIVATE-CANON/)
        asleep = true
        for (const body of [byModel, bySerial, neverSeen])
            await expect(wrapped.transport.connect(body as any)).rejects.toThrow('No USB devices available')
        await client.flush()
        const failures = batches.flatMap(batch => batch.contributions)
            .flatMap((contribution: any) => contribution.entries.filter((entry: any) => entry.kind === 'connect' && entry.failed)
                .map(() => contribution.camera))
        const canon = failures.find((camera: any) => camera.model === 'Canon EOS R8 Mark II')
        const sony = failures.find((camera: any) => camera.model === 'ILCE-6700')
        expect(canon).toMatchObject({ manufacturer: 'Canon.Inc', firmware: 'unknown', transport: 'usb', evidence: 'hardware' })
        expect(canon.hardwareFingerprint).toBeUndefined() // only the model was asked for: any such body could be meant
        expect(sony.hardwareFingerprint).toMatch(/^camera-v1:[a-f0-9]{64}$/)
        expect(failures.filter((camera: any) => camera.model === 'Unknown')).toHaveLength(1) // a body never seen stays unidentified
        expect(JSON.stringify(batches)).not.toMatch(/PRIVATE/)
    } finally { client.close(); configureKnownCameras(undefined); configureSlateTelemetry(undefined) }
})

/** A standard body on the wire: DeviceInfo answers, every other command is refused with `refusal`. */
async function refusingCamera(refusal = 0x2005) {
    const { Camera } = await import('@camera/index')
    const { protocolSession } = await import('@camera/protocol-session')
    const { DeviceInfoCodec } = await import('@ptp/datasets/device-info-dataset')
    const { answeringTransport, ptpContainer } = await import('@tests/fixtures/ptp-wire')
    const { encodedDeviceInfo } = await import('@tests/fixtures/camera-fixtures')
    let camera!: InstanceType<typeof Camera>
    const { transport } = answeringTransport(sent => {
        if (sent.type !== 1) return []
        if (sent.code !== 0x1001) return [ptpContainer(3, refusal, sent.transactionId)]
        const fields = { manufacturer: 'Fixture', model: 'Body', devicePropertiesSupported: [0x5011], operationsSupportedRaw: [0x1001, 0x1014, 0x1016] }
        const dataset = new DeviceInfoCodec(protocolSession(camera).driver.registry).encode(encodedDeviceInfo(camera, fields))
        return [ptpContainer(2, 0x1001, sent.transactionId, dataset), ptpContainer(3, 0x2001, sent.transactionId)]
    })
    camera = new Camera({ transport, logger: { renderInTerminal: false, captureConsole: false } })
    protocolSession(camera).driver.sessionId = 1
    return camera
}

test('each public call is recorded once, with its operation, surface and typed error, and the PTP work under it carries its id', async () => {
    const { client, saved } = await telemetryClient()
    try {
        const camera = await refusingCamera()
        await camera.getInfo() // Identifies the body; its own call is recorded once the session is observed.
        await expect(runOperation(camera, 'setClock', { moment: new Date() }, 'mcp')).rejects.toMatchObject({ name: 'CameraRefusedError' })
        // A typed getter reads getCapabilities inside: one call, the getter's, not two.
        await expect(camera.getShutterSpeed()).rejects.toMatchObject({ name: 'CameraUnsupportedError' })
        const entries = saved.map(item => item.entry)
        const calls = entries.filter(entry => entry.kind === 'call')
        expect(calls.map(entry => entry.call.operation)).toEqual(['getInfo', 'setClock', 'getShutterSpeed'])
        const [info, clock, shutter] = calls
        expect(info).toMatchObject({ failed: false, call: { surface: 'library', outcome: 'ok', tool: 'camera_get_info', attribution: 'async-context' } })
        expect(clock).toMatchObject({
            failed: true,
            call: {
                tool: 'camera_set_clock', command: 'darkgrade camera set-clock', surface: 'mcp', outcome: 'refused',
                arguments: [{ name: 'moment', type: 'time' }],
                error: { type: 'CameraRefusedError', operation: 'setClock', response: 0x2005 },
            },
        })
        expect(shutter.call).toMatchObject({ outcome: 'unsupported', error: { type: 'CameraUnsupportedError', operation: 'shutterSpeed' } })
        // The failing response under setClock is linked to it, and nothing under it belongs to another call.
        const underClock = entries.filter(entry => entry.callId === clock.callId && entry.kind !== 'call')
        expect(underClock.some(entry => entry.kind === 'response' && entry.code === 0x2005)).toBe(true)
        expect(new Set(entries.map(entry => entry.callId)).size).toBe(3)
        validateContribution({ schema: 'darkgrade.diagnostics/v1', disclosure: 'protocol-metadata-only/v1', id: crypto.randomUUID(),
            camera: saved.at(-1).camera, entries, droppedEntries: 0 })
    } finally { client.close() }
})

test('call inputs keep setting values and listed choices but never media ids, and messages lose paths, addresses and serials', async () => {
    const { client, saved } = await telemetryClient()
    try {
        const camera = await refusingCamera()
        await camera.getInfo()
        await runOperation(camera, 'getMediaPreview', { id: '/DCIM/100MSDCF/DSC09876.JPG', size: 'preview' }, 'cli').catch(() => {})
        await camera.setShutterSpeed('1/250').catch(() => {})
        const calls = saved.map(item => item.entry).filter(entry => entry.kind === 'call')
        expect(calls[1].call).toMatchObject({ surface: 'cli', arguments: [{ name: 'id', type: 'text' }, { name: 'size', type: 'choice', value: 'preview' }] })
        expect(calls[2].call.arguments).toEqual([{ name: 'value', type: 'text', value: '1/250' }])
        expect(JSON.stringify(saved)).not.toMatch(/DCIM|DSC09876/)
        expect(redactMessage('No file /Users/me/DCIM/a.JPG on 4294950914 for me@example.com (0x2009)')).toBe(
            'No file [path] on [id] for [email] (0x2009)'
        )
        const leaking = { ...calls[2], call: { ...calls[2].call, error: { type: 'CameraRefusedError', message: 'see /Users/me/x' } } }
        expect(() => validateContribution({ schema: 'darkgrade.diagnostics/v1', disclosure: 'protocol-metadata-only/v1',
            id: crypto.randomUUID(), camera: saved.at(-1).camera, entries: [leaking], droppedEntries: 0 })).toThrow('Invalid API call error')
    } finally { client.close() }
})

/** A wire-level Nikon body: every command is answered by `answer`, and data phases from the host get OK. */
function nikonOnTheWire(answer: (sent: SentContainer) => { code?: number; data?: Uint8Array } | undefined) {
    let command: SentContainer | undefined
    const { transport, sent } = answeringTransport(container => {
        if (container.type === 1) command = container
        if (command?.code === 0x1016 || command?.code === 0x943c) {
            if (container.type !== 2) return
        }
        const reply = answer(command!) ?? {}
        const replies = reply.data ? [ptpContainer(2, command!.code, command!.transactionId, reply.data)] : []
        return [...replies, ptpContainer(3, reply.code ?? 0x2001, command!.transactionId)]
    }, { connected: false })
    const camera = new NikonCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
    return { camera, sent }
}
const uint = (bytes: number, value: number) => {
    const out = new Uint8Array(bytes)
    for (let index = 0; index < bytes; index++) out[index] = (value / 2 ** (8 * index)) & 0xff
    return out
}
/** A GetDevicePropDesc dataset with no form: code, datatype, get/set, default and current value. */
const descriptor = (code: number, dataType: number, size: number, current: number, extended = false) =>
    concatenate([uint(extended ? 4 : 2, code), uint(2, dataType), uint(1, 1), uint(size, current), uint(size, current), uint(1, 0)])

test('responses name the command they answer, and requests keep the value, position and byte counts they asked for', async () => {
    const { client, saved } = await telemetryClient()
    const { camera } = nikonOnTheWire(command => {
        if (command.code === 0x1014) return { data: descriptor(0x500f, 4, 2, 400) } // ISO 400 before the write
        if (command.code === 0x1008)
            return { data: new ObjectInfoCodec(camera.registry).encode(encodedObjectInfo(camera.registry, {
                objectFormat: 0x3801, objectCompressedSize: 0xffffffff, filename: 'DSC_0001.JPG', captureDate: '20261125T101500' })) }
        if (command.code === 0x101b) return { data: new Uint8Array(4) }
        if (command.code === 0x9205) return { code: 0xa001 } // ChangeAfArea refused with HardwareError
        if (command.code === 0x943a) return { data: descriptor(0xd102, 6, 4, 0b11, true) } // WarningStatus read after it
    })
    try {
        await camera.connectTransport()
        await camera.send(camera.registry.operations.GetDevicePropDesc, { DevicePropCode: 0x500f })
        await camera.send(camera.registry.operations.SetDevicePropValue, { DevicePropCode: 0x500f }, uint(2, 800))
        await camera.send(camera.registry.operations.GetObjectInfo, { ObjectHandle: 0x1234 })
        await camera.send(camera.registry.operations.GetPartialObject, { ObjectHandle: 0x1234, Offset: 0, MaxBytes: 16 })
        await camera.send(camera.registry.operations.ChangeAfArea, { X: 3000, Y: 2000 })
        const entries = saved.map(item => item.entry)
        // Every data and response entry says which command it answers.
        const answers = entries.filter(entry => (entry.kind === 'response' || entry.kind === 'data') && !entry.protocol)
        expect(answers.length).toBeGreaterThan(5)
        for (const entry of answers) {
            const command = entries.find(other => other.kind === 'command' && !other.protocol && other.transactionId === entry.transactionId)
            expect(entry.commandCode).toBe(command.code)
        }
        const evidence = entries.filter(entry => entry.protocol).map(entry => entry.protocol)
        expect(evidence).toContainEqual(expect.objectContaining({
            type: 'property-write', property: 0x500f, dataType: 4, requested: 800, prior: 400, outcome: 'response', response: 0x2001 }))
        expect(evidence).toContainEqual(expect.objectContaining({ type: 'object-info', format: 0x3801, size: 0xffffffff, captureDate: '20261125T101500' }))
        expect(evidence).toContainEqual(expect.objectContaining({ type: 'transfer', offset: 0, requestedBytes: 16, receivedBytes: 4 }))
        expect(evidence).toContainEqual(expect.objectContaining({ type: 'focus-point', x: 3000, y: 2000, outcome: 'response', response: 0xa001 }))
        const focus = entries.find(entry => entry.protocol?.type === 'focus-point')
        expect(evidence).toContainEqual({ type: 'warning-status', vendorId: 0x04b0, property: 0xd102, value: 3,
            flags: ['sequence-error', 'battery-exhausted'], operation: 0x9205, transactionId: focus.transactionId })
        expect(JSON.stringify(entries)).not.toMatch(/DSC_0001|4660/) // no file name or handle
        validateContribution({ schema: 'darkgrade.diagnostics/v1', disclosure: 'protocol-metadata-only/v1', id: crypto.randomUUID(),
            camera: saved.at(-1).camera, entries, droppedEntries: 0 })
    } finally { client.close() }
})

test('an inventory read before the vendor driver is chosen is judged against the vendor the DeviceInfo names', () => {
    const registry = createNikonRegistry(true)
    const info = encodedDeviceInfo(registry, { manufacturer: 'Nikon Corporation', operationsSupportedRaw: [0x1001, 0x9205, 0x9201] })
    const unknown = protocolEvidence(0, createPTPRegistry(true), 0x1001, info).filter(item => item.type === 'unknown')
    expect(unknown).toEqual([])
    expect(protocolEvidence(0, createPTPRegistry(true), 0x1001, info)[0]).toMatchObject({ type: 'inventory', vendorId: 0x04b0 })
})

test('a session spans a driver replacing another on the same connection, and observing an open connection says so', async () => {
    const { client, saved } = await telemetryClient()
    const { transport } = answeringTransport(command => [ptpContainer(3, 0x2001, command.transactionId)], { connected: false })
    const logger = new Logger({ captureConsole: false, renderInTerminal: false })
    const discovery = new GenericCamera(transport, logger)
    try {
        await discovery.connectTransport()
        await discovery.send(discovery.registry.operations.OpenSession, { SessionID: 1 })
        discovery.detachTransportObserver()
        const vendor = new NikonCamera(transport, logger)
        await vendor.connectTransport()
        await vendor.send(vendor.registry.operations.CloseSession, {})
        const entries = saved.map(item => item.entry)
        expect(entries.map(entry => entry.kind)).toEqual(['connect', 'command', 'response', 'command', 'response'])
        expect(new Set(entries.map(entry => entry.sessionId)).size).toBe(1)
        vendor.detachTransportObserver()
        // A transport some earlier code opened without an observer: the session starts by saying so.
        const opened = answeringTransport(command => [ptpContainer(3, 0x2001, command.transactionId)]).transport
        const late = new GenericCamera(opened, logger)
        await late.connectTransport()
        await late.send(late.registry.operations.CloseSession, {})
        expect(saved.slice(entries.length).map(item => item.entry.kind)).toEqual(['attach', 'command', 'response'])
    } finally { client.close() }
})


test('Sony writes keep the value seen before them, and its AF-area control is recorded as a position', () => {
    const operations = createSonyRegistry(true).operations
    const subject = { dataType: 2, current: 2, observedAt: 1_000 } // SubjectRecognitionInAF On, read earlier
    const observed = (property: number) => (property === 0xd157 ? subject : undefined)
    const [write] = requestEvidence(0x054c, operations.SDIO_SetExtDevicePropValue, { DevicePropCode: 0xd157 }, Uint8Array.of(1), 9,
        { code: 0x2001 }, observed, 1_250)
    expect(write).toMatchObject({ type: 'property-write', property: 0xd157, requested: 1, prior: 2, priorAgeMilliseconds: 250 })
    const packed = new Uint8Array(4)
    new DataView(packed.buffer).setUint32(0, (320 << 16) | 240, true)
    expect(requestEvidence(0x054c, operations.SDIO_ControlDevice, { sdiControlCode: 0xd2dc }, packed, 10, undefined, observed, 0))
        .toEqual([{ type: 'focus-point', vendorId: 0x054c, x: 320, y: 240, transactionId: 10, outcome: 'error' }])
    // The live-view frame is read many times a second; it is no transfer worth recording.
    expect(requestEvidence(0x054c, operations.GetObject, { ObjectHandle: 0xffffc002 }, undefined, 11,
        { code: 0x2001, data: new Uint8Array(8) }, observed, 0)).toEqual([])
})
