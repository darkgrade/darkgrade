import type { Camera, CameraCapabilities } from '@darkgrade/slate'
import { PTPDisconnectedError, CameraConfirmationError, VendorIDs } from '@darkgrade/slate'
import { CameraService } from '@main/camera-service'
import { CAMERA_CONTROL_NAMES } from '@shared/ipc'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const hotplug = vi.hoisted(() => ({ usb: null as EventEmitter | null }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({ stopSwiftLiveView: () => {} }))
vi.mock('usb', async () => {
    const { EventEmitter } = await import('node:events')
    hotplug.usb ??= new EventEmitter()
    return { usb: hotplug.usb }
})

function fixture() {
    const capabilities: CameraCapabilities = {
        observedAt: Date.now(),
        advertisedOperations: [],
        controls: {
            iso: {
                id: 'iso',
                label: 'ISO',
                aliases: [],
                source: { name: 'ExposureIndex', code: 0x500f, protocol: 'ptp' },
                value: '400',
                allowedValues: ['100', '400'],
                enabled: true,
                writable: true,
            },
            focusMode: {
                id: 'focusMode',
                label: 'Focus mode',
                aliases: [],
                source: { name: 'FocusMode', code: 0x500a, protocol: 'ptp' },
                value: 'AF-S',
                allowedValues: ['AF-S', 'MF'],
                enabled: true,
                writable: true,
            },
        },
    }
    const getCapabilities = vi.fn(async () => capabilities)
    const service = new CameraService()
    Object.assign(service, {
        camera: { getCapabilities, getInstance: () => ({}) } as unknown as Camera,
        connected: true,
    })
    return { service, capabilities, getCapabilities }
}

describe('camera settings refresh failures', () => {
    it('keeps last observations, disables choices, and restores them after a successful refresh', async () => {
        const { service, capabilities, getCapabilities } = fixture()
        await service.refreshSettings()
        expect(service.getState().settings.iso).toBe('400')
        expect(service.getState().controls?.focusMode?.enabled).toBe(true)
        getCapabilities.mockRejectedValueOnce(new Error('Device busy'))
        await service.refreshSettings()
        expect(service.getState().settings.iso).toBe('400')
        expect(service.getState().controls?.focusMode).toEqual({
            value: 'AF-S',
            options: ['AF-S', 'MF'],
            enabled: false,
        })
        capabilities.controls.iso!.value = '100'
        await service.refreshSettings()
        expect(service.getState().settings.iso).toBe('100')
        expect(service.getState().controls?.focusMode?.enabled).toBe(true)
    })
    it('keeps unknown initial values unknown and clears controls that a successful inventory no longer advertises', async () => {
        const { service, capabilities, getCapabilities } = fixture()
        getCapabilities.mockRejectedValueOnce(new Error('Device busy'))
        await service.refreshSettings()
        expect(service.getState().controls).toBeNull()
        expect(service.getState().settings.iso).toBeNull()
        await service.refreshSettings()
        capabilities.controls = {}
        await service.refreshSettings()
        expect(service.getState().settings.iso).toBeNull()
        for (const name of CAMERA_CONTROL_NAMES) expect(service.getState().controls?.[name]).toBeNull()
    })
    it('propagates a disconnected transport and schedules recovery after disabling stale choices', async () => {
        const { service, getCapabilities } = fixture()
        const recover = vi
            .spyOn(service as unknown as { scheduleRecovery(error: unknown): void }, 'scheduleRecovery')
            .mockImplementation(() => {})
        await service.refreshSettings()
        const failure = new PTPDisconnectedError('Camera unplugged')
        getCapabilities.mockRejectedValueOnce(failure)
        await expect(service.refreshSettings()).rejects.toBe(failure)
        expect(service.getState().controls?.focusMode?.enabled).toBe(false)
        expect(recover).toHaveBeenCalledWith(failure)
    })
})

describe('confirmed controls and recording', () => {
    it('shows the observed control returned by Slate rather than the requested alias', async () => {
        const { service, capabilities } = fixture()
        const set = vi.fn(async () => ({ ...capabilities.controls.iso!, value: '100' }))
        Object.assign((service as unknown as { camera: object }).camera, { setControl: set })
        await service.setIso('ISO 100')
        expect(service.getState().settings.iso).toBe('100')
        expect(set).toHaveBeenCalledWith('iso', 'ISO 100')
    })
    it('never displays a failed control request as applied and refreshes actual observations once', async () => {
        const { service, capabilities, getCapabilities } = fixture()
        await service.refreshSettings()
        const failure = new CameraConfirmationError('iso', '800', '400')
        const set = vi.fn(async () => { throw failure })
        Object.assign((service as unknown as { camera: object }).camera, { setControl: set })
        await expect(service.setIso('800')).rejects.toBe(failure)
        expect(service.getState().settings.iso).toBe(capabilities.controls.iso!.value)
        expect(set).toHaveBeenCalledOnce()
        expect(getCapabilities).toHaveBeenCalledTimes(2)
    })
    function recordingFixture() {
        const { service } = fixture()
        const restore = vi.fn(async () => {})
        const camera = { prepareRecordingMode: vi.fn(async () => ({ restore })),
            startRecording: vi.fn(async () => {}), stopRecording: vi.fn(async () => {}),
            getRecordingState: vi.fn(async () => 'idle'), getInstance: () => ({}) }
        Object.assign(service, { camera })
        // File-list timing is independent from confirmation; no background USB work in this test.
        vi.spyOn(service as unknown as { scheduleFilesRefresh(): void }, 'scheduleFilesRefresh').mockImplementation(() => {})
        return { service, camera, restore }
    }
    it('keeps an ignored start idle and restores its prepared mode', async () => {
        const { service, camera, restore } = recordingFixture()
        camera.startRecording.mockRejectedValue(new CameraConfirmationError('record_start', 'recording', 'idle'))
        await expect(service.startRecording()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
        expect(restore).toHaveBeenCalledOnce()
        expect(camera.startRecording).toHaveBeenCalledOnce()
    })
    it('retains Stop and the connection when recording stop is unconfirmed', async () => {
        const { service, camera, restore } = recordingFixture()
        await service.startRecording()
        camera.stopRecording.mockRejectedValue(new CameraConfirmationError('record_stop', 'idle', 'recording'))
        await expect(service.stopRecording()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(service.getState()).toMatchObject({ connected: true, recording: true, recordingState: 'recording' })
        expect(restore).not.toHaveBeenCalled()
        await expect(service.disconnect()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(service.getState().connected).toBe(true)
    })
    it('serializes rapid start/stop changes with state updates inside the queue', async () => {
        const { service, camera } = recordingFixture()
        const calls: string[] = []
        camera.startRecording.mockImplementation(async () => { calls.push('start') })
        camera.stopRecording.mockImplementation(async () => { calls.push('stop') })
        await Promise.all([service.startRecording(), service.stopRecording(), service.startRecording(), service.stopRecording()])
        expect(calls).toEqual(['start', 'stop', 'start', 'stop'])
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
    })
    it('keeps mode restoration retryable after a verified Stop without replaying the Stop command', async () => {
        const { service, camera, restore } = recordingFixture()
        await service.startRecording()
        restore.mockRejectedValueOnce(new Error('setup restoration failed'))
        await expect(service.stopRecording()).rejects.toThrow('restoration failed')
        expect(service.getState()).toMatchObject({ connected: true, recording: true, recordingState: 'idle' })
        await service.stopRecording()
        expect(camera.stopRecording).toHaveBeenCalledOnce()
        expect(restore).toHaveBeenCalledTimes(2)
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
    })
    it('keeps cleanup retryable when a failed Stop reply is followed by a fresh idle observation', async () => {
        const { service, camera, restore } = recordingFixture()
        await service.startRecording()
        camera.stopRecording.mockRejectedValueOnce(new Error('Stop reply lost'))
        await expect(service.stopRecording()).rejects.toThrow('reply lost')
        expect(service.getState()).toMatchObject({ connected: true, recording: true, recordingState: 'idle' })
        expect(restore).not.toHaveBeenCalled()
        await service.stopRecording()
        expect(camera.stopRecording).toHaveBeenCalledOnce()
        expect(restore).toHaveBeenCalledOnce()
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
    })
    function unpluggedWhileRecording() {
        const fixture = recordingFixture()
        const lost = new PTPDisconnectedError('Camera unplugged')
        fixture.camera.stopRecording.mockRejectedValue(lost)
        fixture.camera.getRecordingState.mockRejectedValue(lost)
        Object.assign(fixture.camera, { disconnect: vi.fn(async () => { throw lost }) })
        Object.assign(fixture.service, { detectedVendorId: VendorIDs.SONY })
        const connect = vi.spyOn(fixture.service, 'connect').mockImplementation(async () => fixture.service.getState())
        return { ...fixture, lost, connect }
    }
    const cleared = { connected: false, phase: 'idle', recording: false, recordingState: 'idle', vendor: null }
    it('clears the session when the camera is unplugged mid-recording so a replug reconnects', async () => {
        const { service, camera, connect } = unpluggedWhileRecording()
        await service.startRecording()
        service.startAutoDetect()
        await vi.waitFor(() => expect(hotplug.usb?.listenerCount('detach')).toBe(1))
        const sony = { deviceDescriptor: { idVendor: VendorIDs.SONY } }
        hotplug.usb!.emit('detach', sony)
        await vi.waitFor(() => expect(service.getState()).toMatchObject(cleared))
        expect(camera.stopRecording).toHaveBeenCalledOnce()
        // Tearing down an unplugged session must not start a reconnect of its own.
        expect(connect).not.toHaveBeenCalled()
        vi.useFakeTimers()
        try {
            hotplug.usb!.emit('attach', sony)
            await vi.advanceTimersByTimeAsync(2000)
            expect(connect).toHaveBeenCalledOnce()
        } finally {
            vi.useRealTimers()
            hotplug.usb!.removeAllListeners()
        }
    })
    it('tears down and reconnects when recovery finds the recording transport gone', async () => {
        const { service, lost, connect } = unpluggedWhileRecording()
        await service.startRecording()
        vi.useFakeTimers()
        try {
            ;(service as unknown as { scheduleRecovery(error: unknown): void }).scheduleRecovery(lost)
            await vi.advanceTimersByTimeAsync(2000)
            expect(connect).toHaveBeenCalledOnce()
            expect(service.getState()).toMatchObject(cleared)
        } finally {
            vi.useRealTimers()
        }
    })
})
