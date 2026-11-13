import { expect, it, vi } from 'vitest'
import { withCanonPhotoMode, openCanonRecordingMode, withCanonRecordingMode } from '@vendors/canon/recording-mode'

it('prepares the card before movie selection and restores it only after leaving movie mode', async () => {
    vi.useFakeTimers()
    try {
        const order: string[] = []
        const camera = {
            getCanonUnknownPropertyStates: async () => [],
            getCanonPropertyStates: async () => [{ name: 'CanonAutoExposureMode', value: 1 }],
            prepareCanonRecordingDestination: async () => {
                order.push('card')
                return async () => { order.push('restore destination') }
            },
            enterMovieMode: async () => { order.push('movie on') },
            leaveMovieMode: async () => { order.push('movie off') },
        }
        const opening = openCanonRecordingMode(camera)
        await vi.runAllTimersAsync()
        const mode = await opening
        expect(order).toEqual(['card', 'movie on'])
        await mode.restore()
        expect(order).toEqual(['card', 'movie on', 'movie off', 'restore destination'])
        order.length = 0
        const recording = withCanonRecordingMode(camera, async () => { order.push('record') }, () => false)
        await vi.runAllTimersAsync()
        await recording
        expect(order).toEqual(['card', 'movie on', 'record'])
    } finally { vi.useRealTimers() }
})

it('restores card routing when movie selection fails before a recording starts', async () => {
    const restore = vi.fn(async () => {})
    const camera = {
        getCanonUnknownPropertyStates: async () => [],
        getCanonPropertyStates: async () => [{ name: 'CanonAutoExposureMode', value: 1 }],
        prepareCanonRecordingDestination: async () => restore,
        enterMovieMode: async () => { throw new Error('mode refused') },
    }
    await expect(openCanonRecordingMode(camera)).rejects.toThrow('mode refused')
    expect(restore).toHaveBeenCalledTimes(1)
})

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
