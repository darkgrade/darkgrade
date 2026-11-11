import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
for (const entry of ['@darkgrade/runtime', '@darkgrade/runtime/browser', '@darkgrade/runtime/mcp']) {
    test(`${entry} resolves and bundles without Node built-ins for a browser`, async () => {
        const reached: string[] = []
        const directory = mkdtempSync(fileURLToPath(new URL('./.browser-', import.meta.url)))
        try {
            const fixture = join(directory, 'entry.ts')
            writeFileSync(fixture, `export * from ${JSON.stringify(entry)};\n`)
            const result = await Bun.build({
                entrypoints: [fixture],
                target: 'browser',
                throw: false,
                plugins: [
                    {
                        name: 'no-node-builtins',
                        setup(build) {
                            build.onResolve({ filter: /^[^./]/ }, args => {
                                if (!args.path.startsWith('node:') && !builtins.has(args.path)) return
                                reached.push(`${args.path} from ${args.importer}`)
                                return { path: args.path, external: true }
                            })
                        },
                    },
                ],
            })
            expect(result.success).toBe(true)
            expect(reached).toEqual([])
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
}

test('the browser entry runs queued camera work', async () => {
    const { CameraRuntime } = await import('../src/browser.ts')
    const calls: string[] = []
    const runtime = new CameraRuntime({
        session: () => undefined,
        assertControlAllowed: () => undefined,
        control: async (_camera, action) => calls.push(action),
        observeControls: async (_camera, state) => state,
        invalidate: () => undefined,
        media: async () => {
            calls.push('take-photo')
            return 'photo'
        },
    })
    await Promise.all([runtime.control('cam', 'set-iso', 800), runtime.media('cam', 'take-photo')])
    expect(calls).toEqual(['set-iso', 'take-photo'])
})
