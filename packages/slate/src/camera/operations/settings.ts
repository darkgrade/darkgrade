import type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState } from '@camera/controls'
import type { ExposureContext } from '@camera/exposure-time'
import type { Camera } from '@camera/index'
import { readOperationAvailability } from '@camera/operations/availability'
import { cameraContext, driverCapabilities, requireCapability } from '@camera/operations/context'

/**
 * Settings: the generic control API. The typed accessors (`getShutterSpeed`, `setShutterSpeed`,
 * ...) come from `@camera/settings/typed-settings`, installed on Camera in index.ts; each is
 * `setControl` for its id.
 */
export interface SettingsOperations {
    /**
     * Every setting's current value and choices, which operations this camera supports right now
     * (with the reason when not), and the lens and its focal length.
     */
    getCapabilities(): Promise<CameraCapabilities>
    /**
     * Sets any setting by id, after a fresh read of what the camera offers, and resolves to the
     * value read back. Shutter speed also accepts a duration or angle; cross-unit conversion
     * requires the frame rate in `context`.
     */
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}

export const settingsOperations: SettingsOperations & ThisType<Camera> = {
    async getCapabilities(): Promise<CameraCapabilities> {
        const capabilities = await requireCapability(this, 'settings', 'getCapabilities').readCapabilities()
        await driverCapabilities(this).focus?.capabilitiesObserved?.(capabilities)
        return { ...capabilities, operations: await readOperationAvailability(this, capabilities) }
    },

    async setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState> {
        const settings = requireCapability(this, 'settings', 'setControl')
        return cameraContext(this).controlsQueue.run('camera', async () => {
            const written = await settings.writeControl(id, value, context)
            driverCapabilities(this).focus?.settingWritten(id)
            return written
        })
    },
}
