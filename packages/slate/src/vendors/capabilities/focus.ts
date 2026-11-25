import type { FocusCapability } from '@camera/driver/focus'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's focus capability, or undefined when the driver cannot provide it. The
 * focus slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function focusCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): FocusCapability | undefined {
    return undefined
}
