import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const builtins = new Set(builtinModules.map(name => name.replace(/^node:/, '')))
for (const entry of ['@darkgrade/slate/runtime', '@darkgrade/slate/runtime/browser', '@darkgrade/slate/runtime/mcp']) {
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
    const { CameraRuntime } = await import('@runtime/browser')
    const calls: string[] = []
    const camera = {
        setControl: async (id: string) => {
            calls.push(`setControl ${id}`)
            return { id }
        },
        takePhoto: async () => {
            calls.push('takePhoto')
            return { destination: 'card', name: 'A.JPG', sizeBytes: 1 }
        },
    }
    const runtime = new CameraRuntime({
        discover: async () => [],
        camera: () => camera as unknown as import('@camera/index').Camera,
        assertAllowed: () => undefined,
    })
    await Promise.all([runtime.operation('cam', 'setIso', { value: 'ISO 800' }), runtime.operation('cam', 'takePhoto')])
    expect(calls).toEqual(['setControl iso', 'takePhoto'])
})
