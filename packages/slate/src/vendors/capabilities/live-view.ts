import type { LiveViewCapability } from '@camera/driver/live-view'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's live view capability, or undefined when the driver cannot provide it. The
 * live-view slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function liveViewCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): LiveViewCapability | undefined {
    return undefined
}
