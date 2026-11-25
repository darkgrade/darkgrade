import { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import type { CameraRecordingState } from '@camera/controls'
import { Camera } from '@camera/index'
import { protocolSession } from '@camera/protocol-session'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { openSonyRecordingMode } from '@vendors/sony/photo-mode'
import { afterEach, expect, it, vi } from 'vitest'

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
    if (vendorId === 0x054c) vi.spyOn(protocolSession(camera), 'getSonyPropertyStates').mockResolvedValue([
        {code:0xd160,rawValue:1,sonyEnabledFlag:1},
        {code:0xd248,rawValue:1,sonyEnabledFlag:2},
        {code:0xd24a,rawValue:120,sonyEnabledFlag:2},
    ] as any)
    const read = vi.spyOn(camera, 'getRecordingState').mockImplementation(async () => state)
    const start = vi.spyOn(protocolSession(camera).driver, 'sendStartRecording').mockImplementation(async () => {
        state = 'recording'
    })
    const stop = vi.spyOn(protocolSession(camera).driver, 'sendStopRecording').mockImplementation(async () => {
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

it('explicit Sony preparation uses advertised controls and restores only after confirmed idle', async () => {
    const f = fixture(0x054c)
    let mode = 'Manual'
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls: {exposureProgram: {value:mode,enabled:true,writable:true,allowedValues:['Manual','Movie Manual']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async (_id, value) => {
        mode = value as string
        return {value:mode} as any
    })
    const prepared = await openSonyRecordingMode(f.camera)
    expect(mode).toBe('Movie Manual')
    f.set('recording')
    await expect(prepared.restore()).rejects.toThrow('not confirmed stopped')
    expect(mode).toBe('Movie Manual')
    f.set('idle')
    await prepared.restore()
    expect(mode).toBe('Manual')
    await prepared.restore()
    expect(write.mock.calls.map(call => call[1])).toEqual(['Movie Manual','Manual'])
})

it('Sony preparation refuses unadvertised modes and preserves failed reconciliation', async () => {
    const f = fixture(0x054c)
    const inventory = vi.spyOn(f.camera, 'getCapabilities').mockResolvedValue({
        controls:{exposureProgram:{value:'Manual',enabled:true,writable:false,allowedValues:['Manual','Movie Manual']}},
    } as any)
    const write = vi.spyOn(f.camera, 'setControl')
    await expect(openSonyRecordingMode(f.camera)).rejects.toThrow('no corresponding writable movie mode')
    expect(write).not.toHaveBeenCalled()
    inventory.mockResolvedValue({controls:{exposureProgram:{value:'Manual',enabled:true,writable:true,allowedValues:['Manual','Movie Manual']}}} as any)
    write.mockRejectedValue(new CameraConfirmationError('exposureProgram','Movie Manual','Manual'))
    await expect(openSonyRecordingMode(f.camera)).rejects.toBeInstanceOf(CameraConfirmationError)
    expect(write.mock.calls.map(call => call[1])).toEqual(['Movie Manual','Movie Manual'])
})

it('Sony explicit preparation reconciles one acknowledged unchanged mode with fresh idle admission', async () => {
    const f = fixture(0x054c)
    let mode = 'Manual', attempts = 0
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{exposureProgram:{value:mode,enabled:true,writable:true,allowedValues:['Manual','Movie Manual']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async (_id, value) => {
        if (++attempts === 1) throw new CameraConfirmationError('exposureProgram',String(value),mode)
        mode = value as string
        return {value:mode} as any
    })
    const prepared = await openSonyRecordingMode(f.camera)
    expect(mode).toBe('Movie Manual')
    expect(write.mock.calls.map(call => call[1])).toEqual(['Movie Manual','Movie Manual'])
    expect(f.start).not.toHaveBeenCalled()
    await prepared.restore()
    expect(mode).toBe('Manual')
})

it.each(['unknown','recording','disabled','transport'])('Sony reconciliation stops on %s instead of replaying a mode selection', async reason => {
    const f = fixture(0x054c)
    let writable = true
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{exposureProgram:{value:'Manual',enabled:writable,writable,allowedValues:['Manual','Movie Manual']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async () => {
        if (reason === 'recording') f.set('recording')
        if (reason === 'disabled') writable = false
        if (reason === 'transport') throw new Error('USB read failed')
        throw new CameraConfirmationError('exposureProgram','Movie Manual',reason === 'unknown' ? null : 'Manual')
    })
    await expect(openSonyRecordingMode(f.camera)).rejects.toThrow()
    expect(write).toHaveBeenCalledOnce()
})

it('Sony restoration polls temporary display-only mode after idle without repeating writes', async () => {
    vi.useFakeTimers()
    const f = fixture(0x054c)
    let mode = 'Manual', writable = true
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{exposureProgram:{value:mode,enabled:writable,writable,allowedValues:['Manual','Movie Manual']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async (_id, value) => {
        mode = value as string
        return {value:mode} as any
    })
    const prepared = await openSonyRecordingMode(f.camera)
    writable = false
    const restored = prepared.restore()
    await vi.advanceTimersByTimeAsync(500)
    expect(write.mock.calls.map(call => call[1])).toEqual(['Movie Manual'])
    writable = true
    await vi.advanceTimersByTimeAsync(100)
    await restored
    expect(write.mock.calls.map(call => call[1])).toEqual(['Movie Manual','Manual'])
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

it('Canon recording observation refreshes events instead of confirming a stale cached state', async () => {
    const camera = new Camera({
        vendorId: 0x04a9,
        transport: { isLittleEndian: () => true, on: () => {} } as unknown as TransportInterface,
    })
    const driver = protocolSession(camera).driver as CanonCamera
    let cached = 'CARD'
    const refresh = vi.spyOn(driver, 'refreshEventProperties').mockImplementation(async () => {
        cached = 'NONE'
    })
    vi.spyOn(driver, 'listPropertyStates').mockImplementation(
        () => [{ name: 'CanonRecordingDestination', value: cached }] as never
    )
    expect(await camera.getRecordingState()).toBe('idle')
    expect(refresh).toHaveBeenCalledOnce()
    refresh.mockRejectedValue(new Error('Canon event read failed'))
    await expect(camera.getRecordingState()).rejects.toThrow('event read failed')
})
