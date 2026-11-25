import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { expect, test } from 'bun:test'
import type { Camera } from '@camera/index'
import { HardwareBusyError } from '@runtime/errors'
import { HttpCameraClient } from '@runtime/http-client'
import { createCameraMcpServer } from '@runtime/mcp'
import { surfaceOperations } from '@runtime/operations'
import { CameraRuntime, type CameraProvider } from '@runtime/runtime'

function latch() {
    let release!: () => void
    const promise = new Promise<void>(resolve => {
        release = resolve
    })
    return { promise, release }
}

/** A Camera stand-in that records each public call; only the methods these tests reach exist. */
function fakeCamera(overrides: Record<string, (...parameters: unknown[]) => Promise<unknown>> = {}) {
    const calls: unknown[][] = []
    const record = (name: string, result: unknown = undefined) => async (...parameters: unknown[]) => {
        calls.push([name, ...parameters])
        return result
    }
    const methods: Record<string, (...parameters: unknown[]) => Promise<unknown>> = {
        connect: record('connect'),
        getCapabilities: record('getCapabilities', { controls: { iso: { id: 'iso', value: 'ISO 400' } } }),
        setControl: async (...parameters) => {
            calls.push(['setControl', ...parameters])
            return { id: parameters[0], value: parameters[1] }
        },
        takePhoto: record('takePhoto', { destination: 'card', mediaId: 'm1', name: 'DSC00001.JPG', sizeBytes: 3 }),
        getLiveViewFrame: record('getLiveViewFrame', { jpeg: new Uint8Array([0xff, 0xd8, 0xff]), focusFrames: [] }),
        startRecording: record('startRecording'),
        stopRecording: record('stopRecording', { mediaId: 'c1', name: 'C0001.MP4' }),
        stopZoom: record('stopZoom'),
        setFocusPoint: record('setFocusPoint'),
        setClock: record('setClock'),
        ...overrides,
    }
    return { camera: methods as unknown as Camera, calls }
}

function fixture(camera = fakeCamera()) {
    const allowed: string[] = []
    const provider: CameraProvider = {
        discover: async () => [{ vendorId: 0x054c, productId: 0x0f56 }],
        camera: () => camera.camera,
        assertAllowed: (_camera, operation) => {
            allowed.push(operation)
        },
    }
    return { provider, runtime: new CameraRuntime(provider), calls: camera.calls, allowed }
}

test('the operation table names every MCP tool: one per operation and one setter per setting', async () => {
    const tools = surfaceOperations().flatMap(operation => (operation.mcpTool ? [operation.mcpTool] : []))
    const setters = tools.filter(tool => tool.startsWith('camera_set_') && tool !== 'camera_set_control' && tool !== 'camera_set_focus_point' && tool !== 'camera_set_clock')
    expect(setters).toHaveLength(29)
    for (const name of ['camera_discover', 'camera_get_capabilities', 'camera_set_control', 'camera_set_iso', 'camera_take_photo',
        'camera_get_live_view_frame', 'camera_start_recording', 'camera_stop_recording', 'camera_stop_zoom', 'camera_nudge_focus',
        'camera_download_media', 'camera_get_battery', 'camera_set_clock', 'camera_get_info', 'camera_recover'])
        expect(tools).toContain(name)
    // Settings are read by camera_get_capabilities; events cannot cross a process.
    for (const name of ['camera_get_iso', 'camera_on', 'camera_off', 'camera_get_instance', 'camera_sony_power_zoom'])
        expect(tools).not.toContain(name)
    expect(tools.some(tool => /sony|canon|nikon/.test(tool))).toBe(false)
})

test('MCP runs each tool as the same Camera call, after the host allows it, and rejects unknown inputs', async () => {
    const { runtime, calls, allowed } = fixture()
    const server = createCameraMcpServer(runtime)
    const client = new Client({ name: 'runtime-test', version: '1' })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    try {
        await server.connect(serverTransport)
        await client.connect(clientTransport)
        const { tools } = await client.listTools()
        expect(tools.map(tool => tool.name)).toContain('camera_set_shutter_speed')
        for (const tool of tools) {
            const required = Object.fromEntries((tool.inputSchema.required || []).map(key => [key, key === 'camera' ? 'sony' : 'x']))
            const rejected = await client.callTool({ name: tool.name, arguments: { ...required, misspelledOption: true } })
            expect(rejected.isError).toBe(true)
        }
        expect(calls).toEqual([])
        const iso = await client.callTool({ name: 'camera_set_iso', arguments: { camera: 'sony', value: 'ISO 800' } })
        expect(iso.isError).not.toBe(true)
        expect(calls).toEqual([['setControl', 'iso', 'ISO 800']])
        await client.callTool({ name: 'camera_set_color_temperature', arguments: { camera: 'sony', value: 5600 } })
        expect(calls.at(-1)).toEqual(['setControl', 'colorTemperature', 5600])
        await client.callTool({ name: 'camera_set_focus_point', arguments: { camera: 'sony', x: 0.5, y: 0.4 } })
        expect(calls.at(-1)).toEqual(['setFocusPoint', 0.5, 0.4, { autofocus: true }])
        await client.callTool({ name: 'camera_take_photo', arguments: { camera: 'sony', autofocus: false } })
        expect(calls.at(-1)).toEqual(['takePhoto', { autofocus: false, destination: 'card' }])
        expect(allowed).toEqual(['setIso', 'setColorTemperature', 'setFocusPoint', 'takePhoto'])
        const frame = await client.callTool({ name: 'camera_get_live_view_frame', arguments: { camera: 'sony' } })
        expect((frame.content as { type: string }[]).map(part => part.type)).toEqual(['text', 'image'])
        expect((await client.callTool({ name: 'camera_discover', arguments: {} })).isError).not.toBe(true)
    } finally {
        await client.close()
        await server.close()
    }
})

test('a busy host refuses before anything reaches the camera, with structured busy content', async () => {
    const { runtime, provider, calls } = fixture()
    provider.assertAllowed = () => {
        throw new HardwareBusyError('Other client recording')
    }
    const server = createCameraMcpServer(runtime)
    const client = new Client({ name: 'busy', version: '1' })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    try {
        await server.connect(serverTransport)
        await client.connect(clientTransport)
        const result = await client.callTool({ name: 'camera_get_capabilities', arguments: { camera: 'sony' } })
        expect(result.isError).toBe(true)
        expect(result.structuredContent).toMatchObject({ code: 'HARDWARE_BUSY', busy: true, retryAfterMilliseconds: 1000 })
        expect(calls).toEqual([])
    } finally {
        await client.close()
        await server.close()
    }
})

test('MCP and UI share one queue per camera; other cameras and stops do not wait behind it', async () => {
    const held = latch(),
        entered = latch()
    const camera = fakeCamera({
        takePhoto: async () => {
            entered.release()
            await held.promise
            return { destination: 'card', name: 'A.JPG', sizeBytes: 1 }
        },
    })
    const { runtime, calls } = fixture(camera)
    const photo = runtime.operation('sony', 'takePhoto')
    await entered.promise
    const queued = runtime.operation('sony', 'setIso', { value: 'ISO 800' })
    await runtime.operation('sony', 'stopRecording')
    await runtime.operation('sony', 'stopZoom')
    await runtime.operation('nikon', 'getCapabilities')
    await Bun.sleep(5)
    expect(calls.map(call => call[0])).toEqual(['stopRecording', 'stopZoom', 'getCapabilities'])
    held.release()
    await Promise.all([photo, queued])
    expect(calls.at(-1)).toEqual(['setControl', 'iso', 'ISO 800'])
})

test('inputs are read when the call is made, so a queued call keeps them; malformed input never reaches a camera', async () => {
    const { runtime, calls } = fixture()
    const input = { autofocus: false }
    const photo = runtime.operation('sony', 'takePhoto', input)
    input.autofocus = true
    await photo
    expect(calls).toEqual([['takePhoto', { autofocus: false, destination: 'card' }]])
    for (const [name, bad] of [
        ['takePhoto', { destination: 'memory' }],
        ['takePhoto', { autofocus: 'yes' }],
        ['setFocusPoint', { x: 0.5 }],
        ['setIso', {}],
        ['nudgeFocus', { direction: 'in', size: 'small' }],
        ['setClock', { moment: 'not a time' }],
    ] as const)
        await expect(runtime.operation('sony', name, bad)).rejects.toThrow()
    await expect(runtime.operation('sony', 'getInstance')).rejects.toThrow('Unknown camera operation')
    await expect(runtime.operation('sony', 'on')).rejects.toThrow('Unknown camera operation')
    for (const camera of [null, undefined, 12, '', '   '])
        await expect(runtime.operation(camera as unknown as string, 'getCapabilities')).rejects.toThrow('camera identity')
    expect(calls).toHaveLength(1)
})

test('a failed command is reported once and does not poison the queue', async () => {
    let attempts = 0
    const camera = fakeCamera({
        startRecording: async () => {
            attempts++
            throw new Error('Record was not confirmed')
        },
    })
    const { runtime, calls } = fixture(camera)
    await expect(runtime.operation('canon', 'startRecording')).rejects.toThrow('not confirmed')
    expect(attempts).toBe(1)
    await runtime.operation('canon', 'getCapabilities')
    expect(calls.at(-1)?.[0]).toBe('getCapabilities')
})

test('profile benchmarks serialize with camera work while other cameras remain available', async () => {
    const { runtime, provider, calls } = fixture()
    const entered = latch(),
        held = latch()
    provider.benchmark = async camera => {
        entered.release()
        await held.promise
        return { camera, status: 'partial' }
    }
    const benchmark = runtime.benchmark('nikon')
    await entered.promise
    const waiting = runtime.operation('nikon', 'getCapabilities')
    await runtime.operation('sony', 'getCapabilities')
    expect(calls).toHaveLength(1)
    held.release()
    expect(await benchmark).toEqual({ camera: 'nikon', status: 'partial' })
    await waiting
    expect(calls).toHaveLength(2)
    delete provider.benchmark
    await expect(runtime.benchmark('nikon')).rejects.toThrow('does not expose')
})

test('returned files are saved by the host and described without their bytes', async () => {
    const camera = fakeCamera({
        takePhoto: async () => ({ destination: 'computer', name: 'DSC00002.JPG', sizeBytes: 3, data: new Uint8Array([1, 2, 3]) }),
    })
    const { runtime, provider } = fixture(camera)
    provider.saveFile = async (_camera, file) => `/cache/${file.name}`
    const reply = await runtime.operation('sony', 'takePhoto', { destination: 'computer' })
    expect(reply.result).toEqual({ destination: 'computer', name: 'DSC00002.JPG', sizeBytes: 3, bytes: 3 })
    expect(reply.files).toEqual([{ role: 'photo', name: 'DSC00002.JPG', mimeType: 'image/jpeg', bytes: 3, path: '/cache/DSC00002.JPG' }])
    expect(reply.images).toBeUndefined()
})

test('HTTP client sends one operation request and never retries an ambiguous write', async () => {
    const requests: unknown[] = []
    const client = new HttpCameraClient('http://localhost:8787', async (url, request) => {
        requests.push([String(url), JSON.parse(String(request?.body)), request?.redirect])
        return Response.json({ result: { id: 'iso', value: 'ISO 800' }, files: [] })
    })
    expect((await client.operation('camera / one', 'setIso', { value: 'ISO 800' })).result).toEqual({ id: 'iso', value: 'ISO 800' })
    expect(requests).toEqual([
        ['http://localhost:8787/api/cameras/camera%20%2F%20one/operations/setIso', { value: 'ISO 800' }, 'error'],
    ])
    let calls = 0
    const busy = new HttpCameraClient('http://localhost:8787', async () => {
        calls++
        return Response.json({ code: 'HARDWARE_BUSY', error: 'Busy' }, { status: 409 })
    })
    await expect(busy.operation('sony', 'getCapabilities')).rejects.toBeInstanceOf(HardwareBusyError)
    const timeout = new HttpCameraClient('http://localhost:8787', async () => {
        calls++
        throw new DOMException('timeout', 'TimeoutError')
    })
    await expect(timeout.operation('sony', 'takePhoto')).rejects.toThrow('may still be running')
    expect(calls).toBe(2)
    expect(() => new HttpCameraClient('file:///tmp/runtime')).toThrow('HTTP')
    expect(() => new HttpCameraClient('http://secret:password@host')).toThrow('credentials')
})

test('HTTP input and identity checks happen before any request', async () => {
    let calls = 0
    const client = new HttpCameraClient('http://localhost:8787', async () => {
        calls++
        return Response.json({ result: null, files: [] })
    })
    for (const camera of ['.', '..', '', '   ']) await expect(client.operation(camera, 'getCapabilities')).rejects.toThrow('camera identity')
    await expect(client.operation('sony', 'takePhoto', { destination: 'disk' })).rejects.toThrow('destination')
    await expect(client.operation('sony', 'formatCard')).rejects.toThrow('Unknown camera operation')
    const invalid = new HttpCameraClient('http://localhost:8787', async () => new Response('<html>gateway</html>', { status: 502 }))
    await expect(invalid.operation('sony', 'takePhoto')).rejects.toThrow('Camera request failed (502); the camera operation may still be running')
    expect(calls).toBe(0)
})

test('a lost HTTP reply reports uncertain completion without repeating an executed photo', async () => {
    const { runtime, calls } = fixture()
    const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(_request, server) {
            await runtime.operation('sony', 'takePhoto')
            await server.stop(true)
            return Response.json({ result: null, files: [] })
        },
    })
    try {
        const client = new HttpCameraClient(server.url.href)
        await expect(client.operation('sony', 'takePhoto')).rejects.toThrow('may still be running')
        expect(calls).toEqual([['takePhoto', { autofocus: true, destination: 'card' }]])
    } finally {
        await server.stop(true)
    }
})
