import type { MediaCapability } from '@camera/driver/media'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's media capability, or undefined when the driver cannot provide it. The
 * media slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function mediaCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): MediaCapability | undefined {
    return undefined
}
