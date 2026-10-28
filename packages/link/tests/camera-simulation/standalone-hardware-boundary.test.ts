import { loadRegistry } from '@scripts/camera-lab/camera-registry'
import type { StandaloneRunOptions } from '@scripts/camera-profiles/standalone-run'
import { resolveGuardedLabCamera, runStandalone } from '@scripts/camera-profiles/standalone-run'
import { describe, expect, it, vi } from 'vitest'

describe('standalone physical execution boundary', () => {
    const registry = loadRegistry()

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
