import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, test } from 'bun:test'
import { HardwareBusyError } from '../src/errors.ts'
import { HttpCameraClient } from '../src/http-client.ts'
import { createCameraMcpServer } from '../src/mcp.ts'
import { CameraRuntime, type CameraProvider, type ControlSession } from '../src/runtime.ts'

function fixture() {
    const calls: unknown[] = []
    let session: ControlSession | undefined
    const provider: CameraProvider = {
        session: () => session,
        assertControlAllowed: () => undefined,
        control: async (...arguments_) => {
            calls.push(arguments_)
            return { transport: 'usb' }
        },
        observeControls: async (_camera, state) => state,
        invalidate: (...arguments_) => {
            calls.push(['invalidate', ...arguments_])
        },
        media: async (...arguments_) => {
            calls.push(arguments_)
            return { bytes: 500 }
        },
    }
    return {
        provider,
        calls,
        runtime: new CameraRuntime(provider),
        setSession: (value: ControlSession) => {
            session = value
        },
    }
}
function latch() {
    let release!: () => void
    const promise = new Promise<void>(resolve => {
        release = resolve
    })
    return { promise, release }
}

test('MCP and UI share one queue and resolve the current session after waiting', async () => {
    const { runtime, provider, setSession } = fixture()
    const entered = latch(),
        held = latch(),
        calls: string[] = []
    provider.media = async () => {
        entered.release()
        await held.promise
        calls.push('photo')
        return {}
    }
    const photo = runtime.media('sony', 'take-photo')
    await entered.promise
    const controls = runtime.control('sony', 'status')
    setSession({
        supports: () => true,
        control: async () => {
            calls.push('wifi')
            return { transport: 'wifi' }
        },
    })
    await Bun.sleep(10)
    expect(calls).toEqual([])
    held.release()
    await photo
    expect(await controls).toEqual({ transport: 'wifi' })
    expect(calls).toEqual(['photo', 'wifi'])
})

test('different cameras proceed independently; failed writes do not poison the queue', async () => {
    const { runtime, provider } = fixture(),
        held = latch(),
        entered = latch()
    provider.control = async camera => {
        if (camera === 'canon') {
            entered.release()
            await held.promise
            throw new Error('Rejected')
        }
        return { ok: true }
    }
    const first = runtime.control('canon', 'set-iso', '800').catch(error => error.message)
    await entered.promise
    expect(await runtime.control('nikon', 'status')).toEqual({ ok: true })
    held.release()
    expect(await first).toBe('Rejected')
    provider.control = async () => ({ ok: true })
    expect(await runtime.control('canon', 'status')).toEqual({ ok: true })
})

test('unsupported held-session commands never open a competing connection', async () => {
    const { runtime, calls, setSession } = fixture()
    setSession({ supports: action => action === 'status', control: async () => ({}) })
    await expect(runtime.control('canon', 'set-image-format', 16)).rejects.toThrow('close its Console')
    expect(calls).toEqual([])
})

test('recording/tuning guards are checked before a held-session write', async () => {
    const { runtime, provider, calls } = fixture()
    provider.assertControlAllowed = () => {
        throw new HardwareBusyError('Recording')
    }
    await expect(runtime.control('sony', 'set-iso', 800)).rejects.toThrow('Recording')
    expect(calls).toEqual([])
})

test('invalid actions and media options cannot reach a camera', async () => {
    const { runtime, calls } = fixture()
    await expect(runtime.control('sony', 'raw-command')).rejects.toThrow('Unknown')
    await expect(runtime.media('nikon', 'format-card')).rejects.toThrow('Unsupported')
    await expect(runtime.media('nikon', 'take-photo', { destination: 'invalid' as any })).rejects.toThrow('destination')
    await expect(runtime.media('nikon', 'take-photo', { autofocus: 'false' as any })).rejects.toThrow('autofocus')
    await expect(runtime.media('nikon', 'take-photo', { rawCompression: 'invalid' as any })).rejects.toThrow(
        'compression'
    )
    expect(calls).toEqual([])
})

test('RAW destination and autofocus reach the media provider unchanged', async () => {
    const { runtime, calls } = fixture()
    const options = { autofocus: false, destination: 'memory' as const, rawCompression: 'lossless' as const }
    await runtime.media('nikon', 'take-photo', options)
    expect(calls).toEqual([['nikon', 'take-photo', options]])
})

test('standalone MCP discovers the migrated tools and executes against the shared runtime', async () => {
    const { runtime, calls, provider } = fixture()
    const server = createCameraMcpServer(runtime),
        client = new Client({ name: 'runtime-test', version: '1' })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    try {
        await server.connect(serverTransport)
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        expect(tools).toHaveLength(14)
        expect(tools.some(tool => tool.name === 'plug_power')).toBe(false)
        expect(
            (await client.callTool({ name: 'camera_set_iso', arguments: { camera: 'sony', value: '800' } })).isError
        ).not.toBe(true)
        expect(calls).toContainEqual(['sony', 'set-iso', '800', undefined])
        provider.assertControlAllowed = () => {
            throw new HardwareBusyError('Other client recording')
        }
        const result = await client.callTool({ name: 'camera_controls', arguments: { camera: 'sony' } })
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toMatchObject({
            code: 'HARDWARE_BUSY',
            busy: true,
            retryAfterMilliseconds: 1000,
        })
    } finally {
        await client.close()
        await server.close()
    }
})

test('photo MCP supports explicit focus bypass and Nikon RAW delivery without changing legacy defaults', async () => {
    const { runtime, calls } = fixture()
    const server = createCameraMcpServer(runtime),
        client = new Client({ name: 'photo-options', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    try {
        await server.connect(a)
        await client.connect(b)
        await client.callTool({ name: 'camera_take_photo', arguments: { camera: 'canon' } })
        expect(calls.at(-1)).toEqual(['canon', 'take-photo', {}])
        const result = await client.callTool({
            name: 'camera_take_photo',
            arguments: {
                camera: 'nikon',
                autofocus: false,
                destination: 'memory',
                rawCompression: 'lossless',
            },
        })
        expect(result.isError).not.toBe(true)
        expect(calls.at(-1)).toEqual([
            'nikon',
            'take-photo',
            { autofocus: false, destination: 'memory', rawCompression: 'lossless' },
        ])
    } finally {
        await client.close()
        await server.close()
    }
})

test('HTTP client preserves busy errors and never retries an ambiguous write', async () => {
    let calls = 0
    const client = new HttpCameraClient('http://localhost:8787', async () => {
        calls++
        return Response.json({ code: 'HARDWARE_BUSY', error: 'Busy' }, { status: 409 })
    })
    await expect(client.control('sony', 'status')).rejects.toBeInstanceOf(HardwareBusyError)
    expect(calls).toBe(1)
    const timeout = new HttpCameraClient('http://localhost:8787', async () => {
        calls++
        throw new DOMException('timeout', 'TimeoutError')
    })
    await expect(timeout.media('sony', 'take-photo')).rejects.toThrow('may still be running')
    expect(calls).toBe(2)
})

test('HTTP client encodes camera identity and sends the existing owning-host contract', async () => {
    const calls: unknown[] = []
    const client = new HttpCameraClient('http://localhost:8787', async (url, request) => {
        calls.push([String(url), JSON.parse(String(request?.body)), request?.redirect])
        return Response.json({ ok: true })
    })
    await client.control('camera / one', 'set-iso', '800')
    expect(calls).toEqual([
        ['http://localhost:8787/api/cameras/camera%20%2F%20one/controls', { action: 'set-iso', value: '800' }, 'error'],
    ])
    expect(() => new HttpCameraClient('file:///tmp/runtime')).toThrow('HTTP')
    expect(() => new HttpCameraClient('http://secret:password@host')).toThrow('credentials')
})
