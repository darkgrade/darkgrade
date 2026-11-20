import type { Camera, CameraCapabilities } from '@darkgrade/link'
import { PTPDisconnectedError } from '@darkgrade/link'
import { CameraService } from '@main/camera-service'
import { CAMERA_CONTROL_NAMES } from '@shared/ipc'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({}))

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
