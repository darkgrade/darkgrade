import { timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import type { LocalBench } from './host'
import type { BenchAction, SettingName } from '../src/contracts'

export function serveBench(bench: LocalBench, options: { port?: number; staticRoot: string }) {
    const token = crypto.randomUUID() + crypto.randomUUID()
    const staticRoot = resolve(options.staticRoot)
    const actions: BenchAction[] = ['connect', 'disconnect', 'refresh', 'setting', 'frame', 'photo', 'start', 'stop', 'recover']
    let closing = false
    const headers = {
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
        'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), bluetooth=()',
        'Cache-Control': 'no-store',
    }
    const json = (data: unknown, status = 200) => Response.json(data, { status, headers })
    const server = Bun.serve({
        hostname: 'localhost', port: options.port ?? 5230, maxRequestBodySize: 4096, idleTimeout: 120,
        async fetch(request, listener) {
            const url = new URL(request.url)
            const expectedHost = `localhost:${listener.port}`
            const expectedOrigin = `http://${expectedHost}`
            if (request.headers.get('host') !== expectedHost ||
                (request.headers.get('origin') && request.headers.get('origin') !== expectedOrigin))
                return json({ error: 'Untrusted request origin' }, 403)
            if (url.pathname.startsWith('/api/')) {
                if (closing) return json({ error: 'The host is closing its camera sessions' }, 503)
                if (request.headers.get('X-Testbench-Action') !== '1')
                    return json({ error: 'Use the Test Bench UI' }, 403)
                if (url.pathname === '/api/session' && request.method === 'GET') return json({ token })
                const supplied = request.headers.get('Authorization') ?? ''
                const wanted = 'Bearer ' + token
                const actualBytes = Buffer.from(supplied), expectedBytes = Buffer.from(wanted)
                if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
                    return json({ error: 'Invalid host session' }, 403)
                try {
                    if (url.pathname === '/api/state' && request.method === 'GET') return json(bench.state())
                    if (url.pathname === '/api/scan' && request.method === 'POST') return json(await bench.scan())
                    const match = url.pathname.match(/^\/api\/cameras\/([a-f0-9-]{36})\/action$/)
                    if (!match || request.method !== 'POST') return json({ error: 'Unknown API route' }, 404)
                    if (request.headers.get('Content-Type') !== 'application/json') return json({ error: 'JSON required' }, 415)
                    const body = await request.json()
                    if (!body || typeof body !== 'object' || Array.isArray(body) ||
                        Object.keys(body).some(key => !['action', 'setting', 'value'].includes(key)) ||
                        !actions.includes(body.action) || (body.value !== undefined && (typeof body.value !== 'string' || body.value.length > 100)))
                        return json({ error: 'Invalid camera action' }, 400)
                    const result = await bench.action(match[1], body.action as BenchAction, body.setting as SettingName, body.value)
                    if ('bytes' in result) return new Response(new Uint8Array(result.bytes), { headers: { ...headers,
                        'Content-Type': result.contentType,
                        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}` } })
                    return json(result)
                } catch (error) {
                    return json({ error: error instanceof Error ? error.message : 'Camera request failed', state: bench.state() }, 409)
                }
            }
            if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405)
            let pathname: string
            try { pathname = decodeURIComponent(url.pathname) } catch { return json({ error: 'Invalid path' }, 400) }
            const path = resolve(staticRoot, pathname === '/' ? 'index.html' : '.' + pathname)
            if (!path.startsWith(staticRoot + sep) || !/\.(html|js|css|svg)$/.test(path))
                return json({ error: 'Not found' }, 404)
            const file = Bun.file(path)
            if (!await file.exists()) return json({ error: 'Not found' }, 404)
            return new Response(file, { headers })
        },
    })
    return { server, async close() {
        closing = true
        try { await bench.close(); await server.stop(false) }
        catch (error) { closing = false; throw error }
    } }
}
