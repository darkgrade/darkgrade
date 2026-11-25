import type { VideoCapability } from '@camera/driver/video'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's video capability, or undefined when the driver cannot provide it. The
 * video slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function videoCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): VideoCapability | undefined {
    return undefined
}
