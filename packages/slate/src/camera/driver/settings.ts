import type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState } from '@camera/controls'
import type { ExposureContext } from '@camera/exposure-time'

/**
 * The settings capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * settings slice owns this file and finalizes the result types when the operations land.
 */
export interface SettingsCapability {
    /** Fresh observations; `requested` limits the read to one control and its live guards. */
    readCapabilities(requested?: CameraControlId): Promise<CameraCapabilities>
    /** One admitted write, confirmed by polling reads; never replayed. Resolves to the observation. */
    writeControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}
