import type { CameraEventHandler, CameraEventName } from '@camera/driver/events'
import type { Camera } from '@camera/index'
import { cameraContext, requireCapability } from '@camera/operations/context'
import type { EventDefinition } from '@ptp/types/event'
import type { EventParams } from '@ptp/types/type-helpers'

export interface EventOperations {
    /** Called when a setting changes on the camera (`settingsChanged`) or a new photo or clip lands (`mediaAdded`). */
    on(event: CameraEventName, handler: CameraEventHandler): void
    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void
    /** Stops `handler`, or every handler of the event when none is given. */
    off(event: CameraEventName, handler?: CameraEventHandler): void
    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void
}

interface NamedSubscription {
    event: CameraEventName
    handler: CameraEventHandler
    stop: () => void
}

/** Each Camera's `settingsChanged`/`mediaAdded` listeners, attached to its current driver. */
const namedSubscriptions = new WeakMap<object, NamedSubscription[]>()

function subscriptionsOf(camera: Camera): NamedSubscription[] {
    let subscriptions = namedSubscriptions.get(camera)
    if (!subscriptions) {
        subscriptions = []
        namedSubscriptions.set(camera, subscriptions)
    }
    return subscriptions
}

/** Moves every named listener to the driver chosen on connect, as `on(EventDefinition)` listeners move. */
export function reattachNamedEvents(camera: Camera): void {
    const subscriptions = subscriptionsOf(camera)
    if (!subscriptions.length) return
    const events = requireCapability(camera, 'events', 'on')
    for (const subscription of subscriptions) {
        subscription.stop()
        subscription.stop = events.subscribe(subscription.event, subscription.handler)
    }
}

/** A closed session ends its listeners, as it ends `on(EventDefinition)` listeners. */
export function clearNamedEvents(camera: Camera): void {
    for (const subscription of subscriptionsOf(camera).splice(0)) subscription.stop()
}

const isNamedEvent = (event: CameraEventName | EventDefinition): event is CameraEventName => typeof event === 'string'

/** The overloads pair a named event with a handler that takes nothing. */
function takesNothing<Handler extends (params: never) => void>(
    event: CameraEventName | EventDefinition,
    _handler: Handler | CameraEventHandler
): _handler is CameraEventHandler {
    return isNamedEvent(event)
}

export const eventOperations: EventOperations & ThisType<Camera> = {
    on<E extends EventDefinition>(event: CameraEventName | E, handler: (params: EventParams<E>) => void): void {
        if (isNamedEvent(event)) {
            if (!takesNothing(event, handler)) return
            const stop = requireCapability(this, 'events', 'on').subscribe(event, handler)
            subscriptionsOf(this).push({ event, handler, stop })
            return
        }
        const context = cameraContext(this)
        context.subscriptions.add({ event, handler })
        return context.driver.on(event, handler)
    },

    off<E extends EventDefinition>(event: CameraEventName | E, handler?: (params: EventParams<E>) => void): void {
        if (isNamedEvent(event)) {
            const subscriptions = subscriptionsOf(this)
            for (const subscription of [...subscriptions])
                if (subscription.event === event && (!handler || subscription.handler === handler)) {
                    subscription.stop()
                    subscriptions.splice(subscriptions.indexOf(subscription), 1)
                }
            return
        }
        const context = cameraContext(this)
        for (const subscription of context.subscriptions)
            if (subscription.event.name === event.name && (!handler || subscription.handler === handler))
                context.subscriptions.delete(subscription)
        return context.driver.off(event, handler)
    },
}
