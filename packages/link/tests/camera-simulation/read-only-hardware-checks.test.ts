import { runReadOnlyHardwareChecks } from '@scripts/camera-lab/read-only-hardware-checks'
import type { SimulatedCamera } from '@scripts/camera-profiles/camera-capabilities'
import { describe, expect, it, vi } from 'vitest'

function target(disconnect = vi.fn().mockResolvedValue(undefined)): SimulatedCamera {
    return { camera: { disconnect }, transport: { responseCodes: [], missingData: [] } } as unknown as SimulatedCamera
}

describe('guarded read-only worker lifecycle', () => {
    it('drains an in-flight operation before disconnect and skips further operations after interruption', async () => {
        let stopping = false
        let complete!: () => void
        const disconnect = vi.fn().mockResolvedValue(undefined)
        const second = vi.fn().mockResolvedValue('unexpected')
        const running = runReadOnlyHardwareChecks(target(disconnect), () => stopping, [
            {
                id: 'session',
                run: () =>
                    new Promise(resolve => {
                        complete = () => resolve('connected')
                    }),
            },
            { id: 'device-info', run: second },
        ])
        stopping = true
        await Promise.resolve()
        expect(disconnect).not.toHaveBeenCalled()
        complete()
        const results = await running
        expect(disconnect).toHaveBeenCalledOnce()
        expect(second).not.toHaveBeenCalled()
        expect(results['device-info'].status).toBe('no-data')
    })

    it('stops after failed USB work and closes the session before returning results', async () => {
        const disconnect = vi.fn().mockResolvedValue(undefined)
        const second = vi.fn()
        const results = await runReadOnlyHardwareChecks(target(disconnect), () => false, [
            {
                id: 'session',
                run: async () => {
                    throw new Error('transport timeout')
                },
            },
            { id: 'device-info', run: second },
        ])
        expect(results.session.status).toBe('fail')
        expect(results['device-info'].status).toBe('no-data')
        expect(second).not.toHaveBeenCalled()
        expect(disconnect).toHaveBeenCalledOnce()
    })

    it('fails the worker if disconnect cleanup fails instead of publishing successful results', async () => {
        await expect(
            runReadOnlyHardwareChecks(target(vi.fn().mockRejectedValue(new Error('USB close failed'))), () => false, [
                { id: 'session', run: async () => 'connected' },
            ])
        ).rejects.toThrow('USB close failed')
    })
})
