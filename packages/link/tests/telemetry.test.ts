import { configureLinkTelemetry, linkTelemetry, sdkTelemetry } from '@core/telemetry'
import { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
    configureLinkTelemetry(undefined)
    vi.unstubAllGlobals()
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
        await wrapped.transport.disconnect()
        await wrapped.transport.connect()
        wrapped.transport.on!(events)
        handler!(event)
        expect(events).toHaveBeenCalledTimes(5)
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
            transport: 'sony-sdk',
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
        expect(saved.at(-1).camera).toMatchObject({ model: 'Unknown', transport: 'sony-sdk' })
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
