import { expect, it, vi } from 'vitest'
import { withCanonPhotoMode } from '@vendors/canon/recording-mode'

it('reports the physical Canon selector requirement without retrying an already-active movie mode', async () => {
    vi.useFakeTimers()
    try {
        const camera = {
            getCanonUnknownPropertyStates: async () => [{ name: 'FixedMovie', rawValue: 1 }],
            getCanonPropertyStates: async () => [{ name: 'CanonAutoExposureMode', value: 1 }],
            leaveMovieMode: vi.fn(async () => undefined),
            enterMovieMode: vi.fn(async () => { throw new Error('DeviceBusy') }),
        }
        const capture = vi.fn()
        const result = expect(withCanonPhotoMode(camera, capture)).rejects.toThrow('physical still/movie selector')
        await vi.runAllTimersAsync()
        await result
        expect(capture).not.toHaveBeenCalled()
        expect(camera.enterMovieMode).not.toHaveBeenCalled()
    } finally {
        vi.useRealTimers()
    }
})
