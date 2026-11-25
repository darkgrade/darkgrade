import type { CameraControlId, CameraControlInputs } from '@camera/controls'
import type { SettingsCapability } from '@camera/driver/settings'
import type { ExposureContext } from '@camera/exposure-time'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { readCameraCapabilities, writeCameraControl } from '@vendors/camera-controls'

/**
 * The worked example of a capability group: every driver reads and writes controls through the
 * shared vendor adapter, which owns the per-vendor property maps and encodings.
 */
export function settingsCapability(driver: CameraDriverInstance, owner: Camera): SettingsCapability {
    return {
        readCapabilities: requested => readCameraCapabilities(driver, requested),
        writeControl<Id extends CameraControlId>(id: Id, value: CameraControlInputs[Id], context?: ExposureContext) {
            return writeCameraControl(owner, driver, id, value, context)
        },
    }
}
