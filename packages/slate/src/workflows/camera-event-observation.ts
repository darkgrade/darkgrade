import type { EventDefinition } from '@ptp/types/event'

interface EventCamera {
    registry: { events: Record<string, EventDefinition> }
    on(event: EventDefinition, listener: (parameters: unknown) => void): void
    off(event: EventDefinition, listener: (parameters: unknown) => void): void
    pollEvents?(): Promise<unknown>
}
/** Count decoded event delivery during an owned operation; never retain event payloads. */
export function observeCameraEvents(camera: EventCamera) {
    const delivered = new Map<number, { code: number; name: string; count: number }>()
    const events = [...new Map(Object.values(camera.registry.events).map(event => [event.code, event])).values()]
    const listeners = events.map(event => {
        const listener = () =>
            delivered.set(event.code, { code: event.code, name: event.name, count: (delivered.get(event.code)?.count || 0) + 1 })
        camera.on(event, listener)
        return { event, listener }
    })
    return {
        async finish() {
            let error: string | undefined
            try { await camera.pollEvents?.() }
            catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
            finally { for (const { event, listener } of listeners) camera.off(event, listener) }
            const events = [...delivered.values()]
            return {
                kind: 'native-ptp-events', status: error ? 'failed' : events.length ? 'observed' : 'none-observed',
                events, ...(error && { error }),
                scope: 'Decoded events delivered during this operation; no claim about unobserved event types.',
            }
        },
    }
}
