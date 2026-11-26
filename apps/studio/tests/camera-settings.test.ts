import type { CameraCapabilities } from '@darkgrade/slate'
import { PTPDisconnectedError, CameraClipNotFoundError, CameraConfirmationError, CameraOutcomeUnknownError, PTPRecoveryRequiredError } from '@darkgrade/slate'
import { VendorIDs } from '@darkgrade/slate/protocol'
import { CameraService } from '@main/camera-service'
import { requestedCamera, requiresReconnect } from '@main/camera-service/shared'
import { CAMERA_CONTROL_NAMES } from '@shared/ipc'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const hotplug = vi.hoisted(() => ({ usb: null as EventEmitter | null }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({
    stopSwiftLiveView: () => {},
    onUsbTransportChanged: () => {},
}))
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
    const camera = { getCapabilities, getInstance: () => ({}) }
    const service = new CameraService()
    Object.assign(service, { camera, connected: true })
    return { service, camera, capabilities, getCapabilities }
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

describe('reconnect classification', () => {
    it('reads a lost transport or pending recovery through the cause of a Camera operation error', () => {
        const lost = new PTPDisconnectedError('Camera unplugged')
        expect(requiresReconnect(lost)).toBe(true)
        expect(requiresReconnect(new CameraOutcomeUnknownError('disconnect', lost.message, { cause: lost }))).toBe(true)
        const pending = new PTPRecoveryRequiredError('Transport recovery is still running')
        expect(requiresReconnect(new CameraOutcomeUnknownError('connect', pending.message, { cause: pending }))).toBe(true)
        expect(requiresReconnect(new CameraOutcomeUnknownError('connect', 'no response phase'))).toBe(false)
        expect(requiresReconnect(new Error('Device busy'))).toBe(false)
    })
})

describe('confirmed controls and recording', () => {
    it('shows the observed control returned by Slate rather than the requested alias', async () => {
        const { service, camera, capabilities } = fixture()
        const set = vi.fn(async () => ({ ...capabilities.controls.iso!, value: '100' }))
        Object.assign(camera, { setControl: set })
        await service.setIso('ISO 100')
        expect(service.getState().settings.iso).toBe('100')
        expect(set).toHaveBeenCalledWith('iso', 'ISO 100')
    })
    it('shows the confirmed exposure mode and re-reads the settings a mode change reshapes', async () => {
        const { service, camera, capabilities, getCapabilities } = fixture()
        const exposureMode = {
            id: 'exposureMode' as const,
            label: 'Exposure mode',
            aliases: [],
            source: { name: 'ExposureProgramMode', code: 0x500e, protocol: 'ptp' as const },
            value: 'Manual',
            allowedValues: ['Manual', 'Aperture priority'],
            enabled: true,
            writable: true,
        }
        capabilities.controls.exposureMode = exposureMode
        await service.refreshSettings()
        expect(service.getState().controls?.exposureMode).toEqual({
            value: 'Manual',
            options: ['Manual', 'Aperture priority'],
            enabled: true,
        })
        const set = vi.fn(async () => {
            capabilities.controls.exposureMode = { ...exposureMode, value: 'Aperture priority' }
            return capabilities.controls.exposureMode
        })
        Object.assign(camera, { setControl: set })
        await service.setControl('exposureMode', 'Aperture priority')
        expect(set).toHaveBeenCalledWith('exposureMode', 'Aperture priority')
        expect(service.getState().controls?.exposureMode?.value).toBe('Aperture priority')
        expect(getCapabilities).toHaveBeenCalledTimes(2)
    })
    it('never displays a failed control request as applied and refreshes actual observations once', async () => {
        const { service, camera, capabilities, getCapabilities } = fixture()
        await service.refreshSettings()
        const failure = new CameraConfirmationError('iso', '800', '400')
        const set = vi.fn(async () => { throw failure })
        Object.assign(camera, { setControl: set })
        await expect(service.setIso('800')).rejects.toBe(failure)
        expect(service.getState().settings.iso).toBe(capabilities.controls.iso!.value)
        expect(set).toHaveBeenCalledOnce()
        expect(getCapabilities).toHaveBeenCalledTimes(2)
    })
    function recordingFixture() {
        const { service } = fixture()
        const clip = { mediaId: '2', name: 'C0002.MP4', sizeBytes: 4096 }
        const camera = { startRecording: vi.fn(async () => {}), stopRecording: vi.fn(async (): Promise<typeof clip> => clip),
            getRecordingState: vi.fn(async () => 'idle'), getInstance: () => ({}) }
        Object.assign(service, { camera })
        // File-list timing is independent from confirmation; no background USB work in this test.
        vi.spyOn(service as unknown as { scheduleFilesRefresh(): void }, 'scheduleFilesRefresh').mockImplementation(() => {})
        return { service, camera, clip }
    }
    it('keeps Stop available when a failed start may have left the setup pending', async () => {
        const { service, camera } = recordingFixture()
        camera.startRecording.mockRejectedValue(new CameraOutcomeUnknownError('startRecording', 'putting the camera back failed'))
        await expect(service.startRecording()).rejects.toBeInstanceOf(CameraOutcomeUnknownError)
        expect(service.getState()).toMatchObject({ recording: true, recordingState: 'idle' })
        camera.stopRecording.mockRejectedValueOnce(new CameraClipNotFoundError('stopRecording', 'Record did not start'))
        await service.stopRecording()
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
    })
    it('retains Stop and the connection when recording stop is unconfirmed', async () => {
        const { service, camera } = recordingFixture()
        await service.startRecording()
        camera.stopRecording.mockRejectedValue(new CameraConfirmationError('record_stop', 'idle', 'recording'))
        await expect(service.stopRecording()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(service.getState()).toMatchObject({ connected: true, recording: true, recordingState: 'recording' })
        await expect(service.disconnect()).rejects.toBeInstanceOf(CameraConfirmationError)
        expect(service.getState().connected).toBe(true)
    })
    it('serializes rapid start/stop changes with state updates inside the queue', async () => {
        const { service, camera, clip } = recordingFixture()
        const calls: string[] = []
        camera.startRecording.mockImplementation(async () => { calls.push('start') })
        camera.stopRecording.mockImplementation(async () => { calls.push('stop'); return clip })
        await Promise.all([service.startRecording(), service.stopRecording(), service.startRecording(), service.stopRecording()])
        expect(calls).toEqual(['start', 'stop', 'start', 'stop'])
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
    })
    it('names the confirmed clip, and keeps Stop for a restore Slate could not finish', async () => {
        const { service, camera } = recordingFixture()
        const log = vi.spyOn(service, 'log')
        await service.startRecording()
        camera.stopRecording.mockRejectedValueOnce(new CameraOutcomeUnknownError('stopRecording', 'Recording stopped, but putting the camera back failed'))
        await expect(service.stopRecording()).rejects.toThrow('putting the camera back failed')
        expect(service.getState()).toMatchObject({ connected: true, recording: true, recordingState: 'idle' })
        await service.stopRecording()
        expect(camera.stopRecording).toHaveBeenCalledTimes(2)
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
        expect(log.mock.calls.some(([, message]) => message.includes('C0002.MP4 is on the card'))).toBe(true)
    })
    it('treats a stop that found no new clip as stopped, and says so', async () => {
        const { service, camera } = recordingFixture()
        const log = vi.spyOn(service, 'log')
        await service.startRecording()
        camera.stopRecording.mockRejectedValueOnce(new CameraClipNotFoundError('stopRecording', 'no new clip within 30 seconds'))
        await service.stopRecording()
        expect(service.getState()).toMatchObject({ recording: false, recordingState: 'idle' })
        expect(log.mock.calls.some(([, message, level]) => message.includes('no new clip') && level === 'error')).toBe(true)
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

describe('DARKGRADE_CAMERA', () => {
    it('names the attached camera Studio connects to, as VID:PID like the CLI', () => {
        expect(requestedCamera(undefined)).toBeUndefined()
        expect(requestedCamera('054c:0E78')).toEqual({ vendorId: 0x054c, productId: 0x0e78 })
        expect(() => requestedCamera('sony')).toThrow('USB id such as 054c:0e78')
    })
})
