import type { CanonRawEvent } from '@camera/canon-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { canonDriver, cameraContext } from '@camera/operations/context'
import type { EventDefinition } from '@ptp/types/event'
import type { EventParams } from '@ptp/types/type-helpers'
import type { NikonQueuedEvent } from '@vendors/nikon/event-data'

export interface EventOperations {
    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void
    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void
    pollNikonEvents(): Promise<NikonQueuedEvent[]>
    onCanonRawEvent(listener: (event: CanonRawEvent) => void): void
    offCanonRawEvent(listener: (event: CanonRawEvent) => void): void
}

const canonRawEventsUnavailable = 'Canon raw events require a Canon camera'

export const eventOperations: EventOperations & ThisType<Camera> = {
    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        const context = cameraContext(this)
        context.subscriptions.add({ event, handler })
        return context.driver.on(event, handler)
    },

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        const context = cameraContext(this)
        for (const subscription of context.subscriptions)
            if (subscription.event.name === event.name && (!handler || subscription.handler === handler))
                context.subscriptions.delete(subscription)
        return context.driver.off(event, handler)
    },

    async pollNikonEvents(): Promise<NikonQueuedEvent[]> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof NikonCamera)) throw new Error('Nikon event polling requires a Nikon camera')
        return driver.pollEvents()
    },

    onCanonRawEvent(listener: (event: CanonRawEvent) => void): void {
        canonDriver(this, canonRawEventsUnavailable).onRawEvent(listener)
    },

    offCanonRawEvent(listener: (event: CanonRawEvent) => void): void {
        canonDriver(this, canonRawEventsUnavailable).offRawEvent(listener)
    },
}
