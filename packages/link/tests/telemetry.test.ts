import { configureLinkTelemetry, linkTelemetry, sdkTelemetry } from '@core/telemetry'
import { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
    configureLinkTelemetry(undefined)
    vi.unstubAllGlobals()
})

test('property-write diagnostics preserve each transaction and distinguish a rejected request from readback', async () => {
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const entries: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (_camera, entry) => entries.push(entry),
    })
    configureLinkTelemetry(client)
    const observer = linkTelemetry({ getType: () => 'usb', on: () => {} } as any)
    try {
        await observer.identify({ manufacturer: 'Canon', model: 'Test', deviceVersion: '1' })
        for (const [transactionId, response] of [[23, 0x2019], [24, 0x2001]]) {
            observer.protocol({
                type: 'property-write', vendorId: 0x04a9, property: 0xd1b8,
                dataType: 6, requested: 4, transactionId, outcome: 'response', response,
            }, 0x9110)
        }
        expect(entries).toHaveLength(2)
        expect(entries[0]).toMatchObject({ failed: true, kind: 'command', direction: 'out', transactionId: 23 })
        expect(entries[1]).toMatchObject({ failed: false, transactionId: 24 })
        expect(entries[0].protocol).not.toHaveProperty('current')
        expect(entries.every(entry => entry.sessionId === entries[0].sessionId)).toBe(true)
    } finally { client.close() }
})

test('telemetry retains the native single event handler across attachment, reconnect and identity changes', async () => {
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const entries: any[] = []
    const contexts: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (context, entry) => {
            contexts.push(context)
            entries.push(entry)
        },
    })
    configureLinkTelemetry(client)
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
    const wrapped = linkTelemetry(source)
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
    await linkTelemetry(source).identify({ manufacturer: 'Canon', model: 'EOS 90D', deviceVersion: '1' })
    expect(source.on).not.toHaveBeenCalled()
})

test('SDK telemetry preserves outcomes and profile scoping without passwords, paths, arguments or response payloads', async () => {
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
    })
    configureLinkTelemetry(client)
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
        expect(saved.at(-1).camera).toMatchObject({ model: 'Unknown', transport: 'wifi', backend: 'vendor-api' })
        expect(saved.at(-1).entry.failed).toBe(true)
    } finally {
        client.close()
    }
})

test('connection failures are recorded as unknown identity rather than losing the failure', async () => {
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
    })
    configureLinkTelemetry(client)
    try {
        const source = {
            connect: async () => {
                throw new Error('Original camera failure')
            },
            on: () => {},
            off: () => {},
            getType: () => 'usb',
        } as any
        const observed = linkTelemetry(source)
        await observed.prepare()
        await expect(observed.transport.connect()).rejects.toThrow('Original camera failure')
        expect(saved[0].camera.model).toBe('Unknown')
        expect(saved[0].entry).toMatchObject({ kind: 'connect', failed: true })
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
    configureLinkTelemetry(client)
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
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
    })
    configureLinkTelemetry(client)
    try {
        const source = { on: () => {}, off: () => {}, getType: () => 'usb', isLittleEndian: () => true } as any
        const wrapped = linkTelemetry(source)
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

test('hardware fingerprints track a body without raw serials and are cleared before a failed reconnect', async () => {
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
    })
    configureLinkTelemetry(client)
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
    const wrapped = linkTelemetry(source)
    try {
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
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const saved: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        localRecord: (camera, entry) => saved.push({ camera, entry }),
    })
    configureLinkTelemetry(client)
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
    vi.stubGlobal('__LINK_TELEMETRY_REVISION__', 'abcdef0')
    vi.stubGlobal('__LINK_TELEMETRY_DIRTY__', false)
    const { GenericCamera } = await import('@camera/generic-camera')
    const { resetReportedFacts } = await import('@core/telemetry')
    const { Logger } = await import('@core/logger')
    resetReportedFacts()
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
    })
    configureLinkTelemetry(client)
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
