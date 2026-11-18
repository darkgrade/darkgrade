import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fixtureBench } from './fixture'
import { serveBench } from '../server/http'

test('actual HTTP host protects camera actions, source files and malformed requests', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'usb-bench-http-'))
    await writeFile(join(folder, 'index.html'), '<!doctype html><title>USB bench fixture</title>')
    const { bench, camera } = fixtureBench()
    const app = serveBench(bench, { port: 0, staticRoot: folder })
    const base = `http://localhost:${app.server.port}`
    try {
        expect((await fetch(base + '/api/session')).status).toBe(403)
        expect((await fetch(base, { headers: { Host: 'untrusted.invalid' } })).status).toBe(403)
        expect((await fetch(base + '/api/session', { headers: { 'X-Testbench-Action': '1', Origin: 'https://untrusted.invalid' } })).status).toBe(403)
        const { token } = await (await fetch(base + '/api/session', { headers: { 'X-Testbench-Action': '1' } })).json()
        const headers = { 'X-Testbench-Action': '1', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
        expect((await fetch(base + '/api/state', { headers: { ...headers, Authorization: 'Bearer ' + token.slice(1) + 'é' } })).status).toBe(403)
        const scan = await (await fetch(base + '/api/scan', { method: 'POST', headers })).json()
        expect(camera.calls).toEqual([])
        const path = base + '/api/cameras/' + scan.cameras[0].id + '/action'
        expect((await fetch(path, { method: 'POST', headers, body: '{"action":"connect","extra":true}' })).status).toBe(400)
        expect((await fetch(path, { method: 'POST', headers, body: '{"action":"connect"}' })).status).toBe(200)
        const frame = await fetch(path, { method: 'POST', headers, body: '{"action":"frame"}' })
        expect(frame.headers.get('Content-Type')).toBe('image/png')
        expect((await frame.arrayBuffer()).byteLength).toBeGreaterThan(60)
        expect((await fetch(base + '/@fs/private-file.ts')).status).toBe(404)
        expect((await fetch(base + '/%2E%2E/package.json')).status).toBe(404)
    } finally { await app.close(); await rm(folder, { recursive: true, force: true }) }
}, 15000)
