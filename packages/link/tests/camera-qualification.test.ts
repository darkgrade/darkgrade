import { describe, expect, it } from 'vitest'
import { cameraControlContract, qualifyCameraSetting } from '@workflows/camera-qualification'

describe('camera qualification', () => {
    it('requires independent readback and restores even when the camera changes then reports an error', async () => {
        let value = 'ISO 800'
        const report = await qualifyCameraSetting({
            read: async () => ({ controls: { iso: { value, writable: true, allowedValues: ['ISO 100', 'ISO 800'] } } }),
            set: async (_, requested) => { value = String(requested); if (value === 'ISO 100') throw new Error('Response lost') },
        }, 'iso', '100')
        expect(report).toMatchObject({ passed: false, restored: true, restoredValue: 'ISO 800', error: 'Response lost' })
    })
    it('rejects an ACK without an actual value change', async () => {
        const report = await qualifyCameraSetting({
            read: async () => ({ controls: { iso: { value: '800', access: 'GetSet', allowedValues: ['100', '800'] } } }),
            set: async () => undefined,
        }, 'iso', '100')
        expect(report).toMatchObject({ passed: false, restored: true, observed: '800' })
    })
    it('never qualifies a write if restoration fails', async () => {
        let value = '800'
        const report = await qualifyCameraSetting({
            read: async () => ({ controls: { iso: { value, writable: true, allowedValues: ['100', '800'] } } }),
            set: async (_, requested) => { if (requested === '800') throw new Error('Disconnected'); value = String(requested) },
        }, 'iso', '100')
        expect(report).toMatchObject({ passed: false, restored: false, restorationError: 'Disconnected' })
    })
    it('rejects unadvertised targets before writing and excludes private properties from contracts', async () => {
        let writes = 0
        const state = { controls: { iso: { value: '800', writable: true, allowedValues: ['100', '800'] } }, serialNumber: 'private' }
        await expect(qualifyCameraSetting({ read: async () => state, set: async () => { writes++ } }, 'iso', '64000')).rejects.toThrow('advertised')
        expect(writes).toBe(0)
        expect(JSON.stringify(cameraControlContract(state))).not.toContain('private')
        expect(cameraControlContract({ controls: { iso: { value: 'auto', writable: false } } }).iso?.status).toBe('read-only-in-current-mode')
    })
})
