import { expect, it, describe } from 'vitest'
import { GenericCamera } from '@camera/generic-camera'
import { SonyCamera } from '@camera/sony-camera'
import { NikonCamera } from '@camera/nikon-camera'
import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { observeCameraEvents } from '@workflows/camera-event-observation'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'

describe.each([GenericCamera, SonyCamera, NikonCamera, CanonCamera])('%s event dispatch', Driver => {
    function camera() {
        let deliver!: (event: PTPEvent) => void
        const transport = {
            isLittleEndian: () => true, on: (listener: typeof deliver) => { deliver = listener },
        } as unknown as TransportInterface
        const camera = new Driver(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
        return { camera, deliver: (handle: number) => deliver({ code: 0x4002, transactionId: 1, parameters: [handle] }) }
    }
    it('delivers to observers even when the first capture listener removes itself', () => {
        const fixture = camera(), received: number[] = []
        const event = genericEventRegistry.ObjectAdded
        const first = () => fixture.camera.off(event, first)
        fixture.camera.on(event, first)
        fixture.camera.on(event, params => received.push(params.ObjectHandle))
        fixture.deliver(7); fixture.deliver(8)
        expect(received).toEqual([7, 8])
    })
    it('does not deliver an in-progress event to a newly registered observer', () => {
        const fixture = camera(), received: number[] = []
        const event = genericEventRegistry.ObjectAdded
        const second = (params: { ObjectHandle: number }) => received.push(params.ObjectHandle)
        const first = () => { fixture.camera.off(event, first); fixture.camera.on(event, second) }
        fixture.camera.on(event, first)
        fixture.deliver(7); fixture.deliver(8)
        expect(received).toEqual([8])
        fixture.camera.off(event)
        fixture.deliver(9)
        expect(received).toEqual([8])
    })
})

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

it('keeps partial notifications without claiming event success after a poll failure', async () => {
    const listeners = new Map<string, (value: unknown) => void>()
    const observer = observeCameraEvents({
        registry: { events: genericEventRegistry },
        on: (event, listener) => { listeners.set(event.name, listener) },
        off: event => { listeners.delete(event.name) },
        pollEvents: async () => {
            listeners.get('ObjectAdded')?.({ ObjectHandle: 123 })
            throw new Error('GetEventEx returned DeviceBusy')
        },
    })
    const result = await observer.finish()
    expect(result.status).toBe('failed')
    expect(result.error).toBe('GetEventEx returned DeviceBusy')
    expect(result.events).toContainEqual({ code: 0x4002, name: 'ObjectAdded', count: 1 })
    expect(listeners.size).toBe(0)
})
