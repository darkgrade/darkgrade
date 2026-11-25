import type { BodyCapability } from '@camera/driver/body'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's body capability, or undefined when the driver cannot provide it. The
 * body slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function bodyCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): BodyCapability | undefined {
    return undefined
}
