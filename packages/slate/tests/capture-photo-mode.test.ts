import type { CanonCamera } from '@camera/canon-camera'
import { Camera } from '@camera/index'
import type { SonyCamera } from '@camera/sony-camera'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { expect, it, vi } from 'vitest'

const transport = () => ({ isLittleEndian: () => true }) as unknown as TransportInterface
const info = { filename: 'DSC00001.JPG', captureDate: '20261124T120000', objectCompressedSize: 2 }

it.each([false, true])('takePhoto on Sony restores movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x054c, transport: transport() })
        const driver = camera.getInstance() as SonyCamera
        let mode = 'Movie Flexible Exposure'
        vi.spyOn(driver, 'resumeShooting').mockResolvedValue()
        vi.spyOn(driver, 'refreshPropertyStates').mockImplementation(async () => [
            { code: 0x500e, value: mode, allowedValues: ['Manual', mode] } as never,
        ])
        vi.spyOn(driver, 'set').mockImplementation(async (_property, value) => { mode = String(value) })
        vi.spyOn(driver, 'captureImage').mockImplementation(async () => {
            expect(mode).toBe('Manual')
            if (fail) throw new Error('shutter failed')
            return { info: info as never, data: Uint8Array.of(1, 2) }
        })
        const capture = camera.takePhoto({ destination: 'computer' })
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed')
            : expect(capture).resolves.toMatchObject({ destination: 'computer', name: 'DSC00001.JPG', data: Uint8Array.of(1, 2) })
        await vi.runAllTimersAsync()
        await assertion
        expect(mode).toBe('Movie Flexible Exposure')
    } finally { vi.useRealTimers() }
})

it.each([false, true])('takePhoto on Canon restores remote movie mode after success/failure (%s)', async fail => {
    vi.useFakeTimers()
    try {
        const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
        const driver = camera.getInstance() as CanonCamera
        let movie = true
        vi.spyOn(driver, 'listUnknownPropertyStates').mockImplementation(() =>
            [{ code: 0xd1c2, codeHex: '0xd1c2', name: 'FixedMovie', rawValue: movie ? 1 : 0 }])
        vi.spyOn(driver, 'listPropertyStates').mockReturnValue([
            { code: 0xd105, name: 'CanonAutoExposureMode', description: '', access: 'GetSet', value: 1 },
        ])
        vi.spyOn(driver, 'leaveMovieMode').mockImplementation(async () => { movie = false })
        vi.spyOn(driver, 'enterMovieMode').mockImplementation(async () => { movie = true })
        vi.spyOn(driver, 'captureImage').mockImplementation(async () => {
            expect(movie).toBe(false)
            if (fail) throw new Error('shutter failed')
            return { info: info as never }
        })
        const capture = camera.takePhoto()
        const assertion = fail ? expect(capture).rejects.toThrow('shutter failed')
            : expect(capture).resolves.toEqual({
                destination: 'card', mediaId: '20261124T120000/DSC00001.JPG', name: 'DSC00001.JPG', sizeBytes: 2,
            })
        await vi.runAllTimersAsync()
        await assertion
        expect(movie).toBe(true)
    } finally { vi.useRealTimers() }
})
