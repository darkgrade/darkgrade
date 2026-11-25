import type { ConnectionCapability } from '@camera/driver/connection'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's connection capability, or undefined when the driver cannot provide it. The
 * connection slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function connectionCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): ConnectionCapability | undefined {
    return undefined
}
