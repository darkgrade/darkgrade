import { describe, expect, it, vi } from 'vitest'
import { withCanonPhotoMode } from '@vendors/canon/recording-mode'
import { withSonyPhotoMode } from '@vendors/sony/photo-mode'

describe('Temporary still mode', () => {
    it.each([false, true])('Canon restores movie mode after capture failure=%s', async failure => {
        vi.useFakeTimers()
        let movie = true
        const camera = {
            getCanonUnknownPropertyStates: async () => [{ name: 'FixedMovie', rawValue: movie ? 1 : 0 }],
            getCanonPropertyStates: async () => [{ name: 'CanonAutoExposureMode', value: 0 }],
            leaveMovieMode: async () => { movie = false },
            enterMovieMode: async () => { movie = true },
        }
        try {
            const capture = vi.fn(async () => { expect(movie).toBe(false); if (failure) throw new Error('Transfer failed'); return 'fresh photo' })
            const result = withCanonPhotoMode(camera, capture)
            const check = failure ? expect(result).rejects.toThrow('Transfer failed') : expect(result).resolves.toBe('fresh photo')
            await vi.runAllTimersAsync()
            await check
            expect(movie).toBe(true)
        } finally { vi.useRealTimers() }
    })
    it('Canon refuses shutter when the physical selector overrides the remote request', async () => {
        vi.useFakeTimers()
        try {
            const capture = vi.fn()
            const camera = {
                getCanonUnknownPropertyStates: async () => [{ name: 'FixedMovie', rawValue: 1 }],
                getCanonPropertyStates: async () => [{ name: 'CanonAutoExposureMode', value: 0 }],
                leaveMovieMode: async () => {}, enterMovieMode: async () => {},
            }
            const check = expect(withCanonPhotoMode(camera, capture)).rejects.toThrow('retained movie mode')
            await vi.runAllTimersAsync(); await check
            expect(capture).not.toHaveBeenCalled()
        } finally { vi.useRealTimers() }
    })
    it('Sony restores the exact advertised movie value after failed transfer', async () => {
        vi.useFakeTimers()
        let mode = 'Movie Flexible Exposure'
        const camera: any = {
            getSonyPropertyStates: async () => [{ code: 0x500e, value: mode, allowedValues: ['Manual', mode] }],
            getInstance: () => ({ registry: { properties: { ExposureProgramMode: {} } } }),
            set: async (_property: unknown, value: string) => { mode = value },
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
