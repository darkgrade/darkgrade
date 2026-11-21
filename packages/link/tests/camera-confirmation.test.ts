import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import type { CameraRecordingState } from '@camera/controls'
import { Camera } from '@camera/index'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.useRealTimers())

function fixture(vendorId: number) {
    const camera = new Camera({
        vendorId,
        transport: {
            isLittleEndian: () => true,
            isConnected: () => true,
            on: () => {},
        } as unknown as TransportInterface,
    })
    let state: CameraRecordingState = 'idle'
    const read = vi.spyOn(camera, 'getRecordingState').mockImplementation(async () => state)
    const start = vi.spyOn(camera.getInstance(), 'startRecording').mockImplementation(async () => {
        state = 'recording'
    })
    const stop = vi.spyOn(camera.getInstance(), 'stopRecording').mockImplementation(async () => {
        state = 'idle'
    })
    return {
        camera,
        read,
        start,
        stop,
        set: (value: CameraRecordingState) => {
            state = value
        },
    }
}

describe.each([0x054c, 0x04b0, 0x04a9])('vendor %i confirmed recording lifecycle', vendor => {
    it('serializes rapid start/stop/start/stop pairs through confirmed observations', async () => {
        const f = fixture(vendor)
        await Promise.all([
            f.camera.startRecording(),
            f.camera.stopRecording(),
            f.camera.startRecording(),
            f.camera.stopRecording(),
        ])
        expect(f.start).toHaveBeenCalledTimes(2)
        expect(f.stop).toHaveBeenCalledTimes(2)
        expect(await f.camera.getRecordingState()).toBe('idle')
    })
    it('rejects an ignored acknowledged start without sending a second start', async () => {
        vi.useFakeTimers()
        const f = fixture(vendor)
        f.start.mockResolvedValue(undefined)
        const failure = f.camera.startRecording().catch(error => error)
        await vi.advanceTimersByTimeAsync(5100)
        expect(await failure).toMatchObject({
            name: 'CameraConfirmationError',
            expected: 'recording',
            observed: 'idle',
        })
        expect(f.start).toHaveBeenCalledOnce()
        await f.camera.stopRecording()
        expect(f.stop).not.toHaveBeenCalled() // Fresh idle readback makes Stop idempotent.
    })
    it('retains active recording after an ignored Stop and permits a later explicit Stop', async () => {
        vi.useFakeTimers()
        const f = fixture(vendor)
        await f.camera.startRecording()
        f.stop.mockResolvedValue(undefined)
        const failure = f.camera.stopRecording().catch(error => error)
        await vi.advanceTimersByTimeAsync(15100)
        expect(await failure).toMatchObject({ expected: 'idle', observed: 'recording' })
        expect(f.stop).toHaveBeenCalledOnce()
        expect(await f.camera.getRecordingState()).toBe('recording')
        f.stop.mockImplementation(async () => f.set('idle'))
        await f.camera.stopRecording()
        expect(f.stop).toHaveBeenCalledTimes(2)
    })
    it('never treats missing recording telemetry as idle or authorizes another start', async () => {
        const f = fixture(vendor)
        f.set('unknown')
        await expect(f.camera.startRecording()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(f.start).not.toHaveBeenCalled()
        f.set('recording')
        await expect(f.camera.startRecording()).rejects.toThrow('idle before starting')
        expect(f.start).not.toHaveBeenCalled()
    })
})

it('polls delayed observations without repeating writes and propagates observation failures', async () => {
    vi.useFakeTimers()
    let value = 'old'
    const read = vi.fn(async () => value)
    const pending = confirmCameraValue('iso', '200', read)
    await vi.advanceTimersByTimeAsync(150)
    value = '200'
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(read.mock.calls.length).toBeGreaterThan(1)
    const failure = new Error('USB disappeared during readback')
    await expect(
        confirmCameraValue('iso', '200', async () => {
            throw failure
        })
    ).rejects.toBe(failure)
})

it('canonical recording observation preserves native Sony transitional and unknown states', async () => {
    const camera = new Camera({
        vendorId: 0x054c,
        transport: {
            isLittleEndian: () => true,
            on: () => {},
        } as unknown as TransportInterface,
    })
    const read = vi.spyOn(camera, 'getSonyPropertyStates')
    for (const [rawValue, expected] of [
        [0, 'idle'],
        [1, 'recording'],
        [2, 'starting'],
        [3, 'stopping'],
        [4, 'unknown'],
        [null, 'unknown'],
    ] as const) {
        read.mockResolvedValue([{ code: 0xd21d, rawValue }] as never)
        expect(await camera.getRecordingState()).toBe(expected)
    }
})
