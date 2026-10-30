import { expect, it } from 'vitest'
import { observeCameraEvents } from '@workflows/camera-event-observation'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'

it('records decoded delivery without exporting parameters and removes listeners after polling', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const observer = observeCameraEvents({
        registry: { events: genericEventRegistry },
        on: (event, listener) => { listeners.set(event.name, listener) },
        off: event => { listeners.delete(event.name) },
        pollEvents: async () => { listeners.get('ObjectAdded')?.({ ObjectHandle: 123, private: 'secret' }) },
    })
    const result = await observer.finish()
    expect(result.status).toBe('observed')
    expect(result.events).toContainEqual({ code: 0x4002, name: 'ObjectAdded', count: 1 })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(listeners.size).toBe(0)
})
