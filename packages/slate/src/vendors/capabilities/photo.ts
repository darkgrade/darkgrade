import type { PhotoCapability } from '@camera/driver/photo'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's photo capability, or undefined when the driver cannot provide it. The
 * photo slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function photoCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): PhotoCapability | undefined {
    return undefined
}
