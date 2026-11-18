import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'vite'

test('development server refuses real files outside the demo root and unapproved hosts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'testbench-boundary-'))
    const filename = join(directory, 'private-fixture.txt')
    const marker = 'outside-demo-root-test-marker'
    await writeFile(filename, marker)
    const server = await createServer({
        configFile: resolve(import.meta.dirname, '../vite.config.ts'),
        server: { port: 0, strictPort: false },
        logLevel: 'silent',
    })
    try {
        await server.listen()
        const base = server.resolvedUrls?.local[0]
        if (!base) throw Error('Demo development server did not bind locally')
        const response = await fetch(new URL('/@fs/' + filename, base))
        expect(response.status).toBe(403)
        expect(await response.text()).not.toContain(marker)
        const host = await fetch(base, { headers: { Host: 'untrusted.example.invalid' } })
        expect(host.status).toBe(403)
    } finally {
        await server.close()
        await rm(directory, { recursive: true, force: true })
    }
}, 15_000)
