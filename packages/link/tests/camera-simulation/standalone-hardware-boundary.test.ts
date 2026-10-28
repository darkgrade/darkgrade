import { loadRegistry } from '@scripts/camera-lab/camera-registry'
import type { StandaloneRunOptions } from '@scripts/camera-profiles/standalone-run'
import { hardwareMatrixName, resolveGuardedLabCamera, runStandalone } from '@scripts/camera-profiles/standalone-run'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

describe('standalone physical execution boundary', () => {
    const registry = loadRegistry()

    it('uses the current bench or explicit camera id when identical models exist on multiple benches', () => {
        const multiple = structuredClone(registry)
        const original = multiple.cameras.find(camera => camera.id === 'canon-eos-80d')!
        multiple.cameras.push({
            ...structuredClone(original),
            id: 'second-eos-80d',
            host: 'darkgrade02',
            benchLabel: 'second-canon',
        })
        expect(() => resolveGuardedLabCamera(multiple, { usb: '04a9:3294' })).toThrow(/Multiple bench bodies/)
        expect(resolveGuardedLabCamera(multiple, { usb: '04a9:3294', host: 'darkgrade02' }).id).toBe('second-eos-80d')
        expect(resolveGuardedLabCamera(multiple, { usb: '04a9:3294', camera: 'canon-eos-80d' }).id).toBe(
            'canon-eos-80d'
        )
    })

    it('never turns an imported profile id into a filesystem path outside result storage', () => {
        for (const profileId of ['../escape', '/tmp/escape', 'camera/../../escape', '..', '', 'Uppercase', 'bad--id'])
            expect(() => hardwareMatrixName(profileId, 'usb')).toThrow(/kebab-case/)
        expect(hardwareMatrixName('camera-model-2', 'ptp-ip')).toBe('camera-model-2.ptp-ip.json')
    })

    it('preserves the last valid observation when a new run is refused before hardware access', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'guarded-lab-result-'))
        const output = path.join(directory, 'last-valid.json')
        writeFileSync(output, 'last valid observation')
        try {
            const result = spawnSync(
                'bun',
                [
                    'run',
                    path.resolve(__dirname, '../../scripts/camera-lab/run-hardware-suite.ts'),
                    '--camera',
                    'canon-eos-80d',
                    '--output',
                    output,
                ],
                {
                    env: { ...process.env, DARKGRADE_TESTBENCH_DIR: '' },
                    timeout: 10_000,
                }
            )
            expect(result.error).toBeUndefined()
            expect(result.status).not.toBe(0)
            expect(result.stderr.toString()).toContain('no camera operation attempted')
            expect(readFileSync(output, 'utf8')).toBe('last valid observation')
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })

    it('selects the deployed bench mapping by USB identity rather than by its legacy slot label', () => {
        expect(resolveGuardedLabCamera(registry, { usb: '04a9:3294', profile: 'canon-eos-80d' })).toMatchObject({
            id: 'canon-eos-80d',
            benchLabel: 'canon-r7',
            host: 'darkgrade01',
        })
    })

    it('refuses IP, unregistered models, charging identities and mismatched profile overrides', () => {
        for (const selection of [
            { ip: '192.168.1.2', usb: '04a9:3294' },
            { usb: '04a9:ffff' },
            { usb: '054c:096f' },
            { usb: '04a9:3294', profile: 'canon-eos-r6-mark-iii' },
        ])
            expect(() => resolveGuardedLabCamera(registry, selection)).toThrow()
    })

    it('rejects direct real-transport injection before any camera connection is opened', async () => {
        const connect = vi.fn()
        await expect(
            runStandalone({ profile: {}, transport: { connect } } as unknown as StandaloneRunOptions)
        ).rejects.toThrow(/guarded bench adapter/)
        expect(connect).not.toHaveBeenCalled()
    })
})
