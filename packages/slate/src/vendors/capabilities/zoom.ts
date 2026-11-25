import type { ZoomCapability } from '@camera/driver/zoom'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's zoom capability, or undefined when the driver cannot provide it. The
 * zoom slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function zoomCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): ZoomCapability | undefined {
    return undefined
}
