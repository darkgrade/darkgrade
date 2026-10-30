import { Camera } from '@camera/index'
import { expect, it, vi } from 'vitest'

it.each([false, true])('public Sony capture restores movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x054c, transport: { isLittleEndian: () => true } as any,
            logger: { captureConsole: false, renderInTerminal: false } })
        let mode = 'Movie Flexible Exposure'
        vi.spyOn(camera, 'getSonyPropertyStates').mockResolvedValue([
            { code: 0x500e, value: mode, allowedValues: ['Manual', mode] } as any,
        ])
        vi.spyOn(camera, 'set').mockImplementation(async (_property, value) => { mode = String(value) })
        vi.spyOn(camera.getInstance(), 'captureImage').mockImplementation(async () => {
            expect(mode).toBe('Manual')
            if (fail) throw new Error('shutter failed')
            return { data: Uint8Array.of(1, 2) }
        })
        const capture = camera.captureImage()
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed')
            : expect(capture).resolves.toEqual({ data: Uint8Array.of(1, 2) })
        await vi.runAllTimersAsync()
        await assertion
        expect(mode).toBe('Movie Flexible Exposure')
    } finally { vi.useRealTimers() }
})

it.each([false, true])('public Canon capture restores remote movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x04a9, transport: { isLittleEndian: () => true } as any,
            logger: { captureConsole: false, renderInTerminal: false } })
        let movie = true
        vi.spyOn(camera, 'getCanonUnknownPropertyStates').mockImplementation(async () =>
            [{ name: 'FixedMovie', rawValue: movie ? 1 : 0 }] as any)
        vi.spyOn(camera, 'getCanonPropertyStates').mockResolvedValue([{ name: 'CanonAutoExposureMode', value: 1 }] as any)
        vi.spyOn(camera, 'leaveMovieMode').mockImplementation(async () => { movie = false })
        vi.spyOn(camera, 'enterMovieMode').mockImplementation(async () => { movie = true })
        vi.spyOn(camera.getInstance(), 'captureImage').mockImplementation(async () => {
            expect(movie).toBe(false)
            if (fail) throw new Error('shutter failed')
            return {}
        })
        const capture = camera.captureImage()
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed') : expect(capture).resolves.toEqual({})
        await vi.runAllTimersAsync()
        await assertion
        expect(movie).toBe(true)
    } finally { vi.useRealTimers() }
})
