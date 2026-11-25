import { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraConfirmationError } from '@camera/confirmation'
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

it('Sony preparation refuses unadvertised modes and preserves failed reconciliation', async () => {
    const f = fixture(0x054c)
    const inventory = vi.spyOn(f.camera, 'getCapabilities').mockResolvedValue({
        controls:{photoVideoMode:{value:'photo',enabled:true,writable:false,allowedValues:['photo','video']}},
    } as any)
    const write = vi.spyOn(f.camera, 'setControl')
    await expect(openSonyRecordingMode(f.camera)).rejects.toThrow('no corresponding writable movie mode')
    expect(write).not.toHaveBeenCalled()
    inventory.mockResolvedValue({controls:{photoVideoMode:{value:'photo',enabled:true,writable:true,allowedValues:['photo','video']}}} as any)
    write.mockRejectedValue(new CameraConfirmationError('photoVideoMode','video','photo'))
    await expect(openSonyRecordingMode(f.camera)).rejects.toBeInstanceOf(CameraConfirmationError)
    expect(write.mock.calls.map(call => call[1])).toEqual(['video','video'])
})

it('Sony explicit preparation reconciles one acknowledged unchanged mode with fresh idle admission', async () => {
    const f = fixture(0x054c)
    let mode = 'photo', attempts = 0
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{photoVideoMode:{value:mode,enabled:true,writable:true,allowedValues:['photo','video']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async (_id, value) => {
        if (++attempts === 1) throw new CameraConfirmationError('photoVideoMode',String(value),mode)
        mode = value as string
        return {value:mode} as any
    })
    const prepared = await openSonyRecordingMode(f.camera)
    expect(mode).toBe('video')
    expect(write.mock.calls.map(call => call[1])).toEqual(['video','video'])
    expect(f.start).not.toHaveBeenCalled()
    await prepared.restore()
    expect(mode).toBe('photo')
})

it.each(['unknown','recording','disabled','transport'])('Sony reconciliation stops on %s instead of replaying a mode selection', async reason => {
    const f = fixture(0x054c)
    let writable = true
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{photoVideoMode:{value:'photo',enabled:writable,writable,allowedValues:['photo','video']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async () => {
        if (reason === 'recording') f.set('recording')
        if (reason === 'disabled') writable = false
        if (reason === 'transport') throw new Error('USB read failed')
        throw new CameraConfirmationError('photoVideoMode','video',reason === 'unknown' ? null : 'photo')
    })
    await expect(openSonyRecordingMode(f.camera)).rejects.toThrow()
    expect(write).toHaveBeenCalledOnce()
})

it('Sony restoration polls temporary display-only mode after idle without repeating writes', async () => {
    vi.useFakeTimers()
    const f = fixture(0x054c)
    let mode = 'photo', writable = true
    vi.spyOn(f.camera, 'getCapabilities').mockImplementation(async () => ({
        controls:{photoVideoMode:{value:mode,enabled:writable,writable,allowedValues:['photo','video']}},
    }) as any)
    const write = vi.spyOn(f.camera, 'setControl').mockImplementation(async (_id, value) => {
        mode = value as string
        return {value:mode} as any
    })
    const prepared = await openSonyRecordingMode(f.camera)
    writable = false
    const restored = prepared.restore()
    await vi.advanceTimersByTimeAsync(500)
    expect(write.mock.calls.map(call => call[1])).toEqual(['video'])
    writable = true
    await vi.advanceTimersByTimeAsync(100)
    await restored
    expect(write.mock.calls.map(call => call[1])).toEqual(['video','photo'])
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
