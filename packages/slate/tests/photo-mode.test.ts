import { describe, expect, it, vi } from 'vitest'
import { withSonyPhotoMode } from '@vendors/sony/photo-mode'

describe('Temporary still mode', () => {
    it('Sony restores the exact advertised movie value after failed transfer', async () => {
        vi.useFakeTimers()
        let mode = 'Movie Flexible Exposure'
        const camera = {
            refreshPropertyStates: async () => [{ code: 0x500e, value: mode, allowedValues: ['Manual', mode] }],
            setExposureProgram: async (value: string) => { mode = value },
        }
        try {
            const check = expect(withSonyPhotoMode(camera, async () => {
                expect(mode).toBe('Manual'); throw new Error('Incomplete image')
            })).rejects.toThrow('Incomplete image')
            await vi.runAllTimersAsync(); await check
            expect(mode).toBe('Movie Flexible Exposure')
        } finally { vi.useRealTimers() }
    })
})
