import type { EventsCapability } from '@camera/driver/events'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'

/**
 * Each vendor's events capability, or undefined when the driver cannot provide it. The
 * events slice fills this in (vendor branching belongs here, never in the Camera façade), following
 * `@vendors/capabilities/settings`.
 */
export function eventsCapability(
    _driver: CameraDriverInstance,
    _owner: Camera
): EventsCapability | undefined {
    return undefined
}
