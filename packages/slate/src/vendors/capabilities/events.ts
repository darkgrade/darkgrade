import { CanonCamera, type CanonRawEvent } from '@camera/canon-camera'
import type { CameraEventHandler, CameraEventName, EventsCapability } from '@camera/driver/events'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import type { CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { EventDefinition } from '@ptp/types/event'
import type { EventParams } from '@ptp/types/type-helpers'

/** Event names, across the standard and vendor registries, that mean each public event. */
const EVENT_DEFINITION_NAMES: Record<CameraEventName, readonly string[]> = {
    settingsChanged: ['DevicePropChanged', 'SDIE_DevicePropChanged'],
    // A Nikon SDRAM object is a capture to the computer, not a file on the card.
    mediaAdded: ['ObjectAdded', 'SDIE_ObjectAdded'],
}

/** EOS GetEvent records: a value or its choices changed, or a new file reached the card. */
function canonEventCodes(driver: CanonCamera, event: CameraEventName): readonly number[] {
    const events = driver.registry.events
    return event === 'settingsChanged'
        ? [events.CanonValueChanged.code, events.CanonAllowedValuesChanged.code]
        : [events.CanonObjectAddedEx.code, events.CanonObjectAddedEx64.code]
}

/**
 * A Sony body saving to its card sends no ObjectAdded; its card index announces the file instead.
 * Event type 1 followed each new photo on an α7 V (bench, 2026-11-24); other types are not mapped.
 */
const SONY_CONTENT_ADDED_EVENT_TYPE = 1

function sonyCardIndexAdditions(driver: SonyCamera, handler: CameraEventHandler): () => void {
    const definition = driver.registry.events.SDIE_ContentInfoListChanged
    const listener = (params: EventParams<typeof definition>) => {
        if (Number(params['Event Type']) === SONY_CONTENT_ADDED_EVENT_TYPE) handler()
    }
    driver.on(definition, listener)
    return () => driver.off(definition, listener)
}

/** How often Nikon's event queue is read while someone is listening. */
export const NIKON_EVENT_POLL_INTERVAL_MILLISECONDS = 500

function registryEvents(driver: CameraDriverInstance, event: CameraEventName): EventDefinition[] {
    const events: Record<string, EventDefinition> = driver.registry.events
    return Object.values(events).filter(definition => EVENT_DEFINITION_NAMES[event].includes(definition.name))
}

/** Events the driver emits as they arrive: the USB interrupt pipe, or Canon's own event loop. */
function emittedEvents(driver: CameraDriverInstance, event: CameraEventName, handler: CameraEventHandler): () => void {
    const definitions = registryEvents(driver, event)
    const listener = () => handler()
    for (const definition of definitions) driver.on(definition, listener)
    return () => {
        for (const definition of definitions) driver.off(definition, listener)
    }
}

function canonEvents(driver: CanonCamera, event: CameraEventName, handler: CameraEventHandler): () => void {
    const codes = canonEventCodes(driver, event)
    const listener = (raw: CanonRawEvent) => {
        if (codes.includes(raw.code)) handler()
    }
    driver.onRawEvent(listener)
    return () => driver.offRawEvent(listener)
}

/**
 * Nikon queues events until GetEventEx reads them, and opening a camera starts no background poll.
 * The pump runs only while at least one listener exists, so a camera nobody listens to keeps its
 * queue for the operations that read it; a memory capture keeps its own announcements either way.
 */
function nikonEventPump(driver: NikonCamera) {
    let listeners = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
        timer = setTimeout(async () => {
            timer = undefined
            if (listeners === 0) return
            if (driver.sessionId !== null) await driver.pollEvents().catch(() => undefined)
            if (listeners > 0) schedule()
        }, NIKON_EVENT_POLL_INTERVAL_MILLISECONDS)
    }
    return {
        attach(): () => void {
            listeners++
            if (listeners === 1 && !timer) schedule()
            let attached = true
            return () => {
                if (!attached) return
                attached = false
                listeners--
                if (listeners === 0 && timer) {
                    clearTimeout(timer)
                    timer = undefined
                }
            }
        },
    }
}

/** Each vendor's settingsChanged and mediaAdded events. */
export function eventsCapability(driver: CameraDriverInstance, _owner: Camera): EventsCapability {
    if (driver instanceof CanonCamera) return { subscribe: (event, handler) => canonEvents(driver, event, handler) }
    if (driver instanceof NikonCamera) {
        const pump = nikonEventPump(driver)
        return {
            subscribe(event, handler) {
                const stopEmitted = emittedEvents(driver, event, handler)
                const detach = pump.attach()
                return () => {
                    stopEmitted()
                    detach()
                }
            },
        }
    }
    if (driver instanceof SonyCamera)
        return {
            subscribe(event, handler) {
                const stopEmitted = emittedEvents(driver, event, handler)
                if (event !== 'mediaAdded') return stopEmitted
                const stopIndex = sonyCardIndexAdditions(driver, handler)
                return () => {
                    stopEmitted()
                    stopIndex()
                }
            },
        }
    return { subscribe: (event, handler) => emittedEvents(driver, event, handler) }
}
