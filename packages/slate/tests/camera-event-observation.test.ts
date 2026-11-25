import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { CanonCamera } from '@vendors/canon/canon-camera'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { Camera } from '@camera/index'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { Logger } from '@core/logger'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import type { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { observeCameraEvents } from '@workflows/camera-event-observation'
import { describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

describe('public Camera USB connection lifecycle', () => {
    it.each(['disconnect', 'recover'] as const)(
        'restores events and connection state after %s on the same object',
        async cleanup => {
            const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
            let connected = false
            let listener: ((event: PTPEvent) => void) | null = null
            vi.spyOn(transport, 'isConnected').mockImplementation(() => connected)
            vi.spyOn(transport, 'connect').mockImplementation(async () => {
                connected = true
            })
            vi.spyOn(transport, 'disconnect').mockImplementation(async () => {
                connected = false
                listener = null
            })
            vi.spyOn(transport, 'getDeviceIdentity').mockImplementation(() =>
                connected ? { vendorId: 0x054c, productId: 1 } : undefined
            )
            vi.spyOn(transport, 'on').mockImplementation(handler => {
                listener = handler
            })
            const camera = new Camera({ vendorId: 0x054c, transport })
            const driver = protocolSession(camera).driver
            // Keep real transport/session setup; vendor authentication is covered independently.
            vi.spyOn(driver, 'connect').mockImplementation((device?: DeviceDescriptor) =>
                GenericCamera.prototype.connect.call(driver, device)
            )
            const reset = vi.spyOn(
                (driver as unknown as { channel: { newConnection(): void } }).channel,
                'newConnection'
            )
            vi.spyOn(driver, 'send').mockResolvedValue({
                code: 0x2001,
                data: { manufacturer: 'Fixture', model: 'Fixture', deviceVersion: '1' },
            } as never)
            const received: number[] = []
            const event = genericEventRegistry.ObjectAdded
            const subscribe = () => protocolSession(camera).on(event, params => received.push(params.ObjectHandle))
            const emit = (handle: number) => listener?.({ code: event.code, transactionId: 1, parameters: [handle] })
            try {
                await camera.connect()
                subscribe()
                emit(7)
                if (cleanup === 'disconnect') {
                    await camera.disconnect()
                    subscribe() // Explicit disconnect intentionally removes application subscriptions.
                } else {
                    const report = await camera.recover({ allowPortReset: false })
                    expect(report.recovered).toBe(true)
                }
                const resetsBeforeReconnect = reset.mock.calls.length
                await camera.connect()
                emit(8)
                expect(received).toEqual([7, 8])
                expect(reset).toHaveBeenCalledTimes(resetsBeforeReconnect + 1)
            } finally {
                await camera.disconnect()
            }
        }
    )
})

describe.each([GenericCamera, SonyCamera, NikonCamera, CanonCamera])('%s event dispatch', Driver => {
    function camera() {
        let deliver!: (event: PTPEvent) => void
        const transport = {
            isLittleEndian: () => true,
            on: (listener: typeof deliver) => {
                deliver = listener
            },
        } as unknown as TransportInterface
        const camera = new Driver(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
        return {
            camera,
            deliver: (handle: number) => deliver({ code: 0x4002, transactionId: 1, parameters: [handle] }),
        }
    }
    it('delivers to observers even when the first capture listener removes itself', () => {
        const fixture = camera(),
            received: number[] = []
        const event = genericEventRegistry.ObjectAdded
        const first = () => fixture.camera.off(event, first)
        fixture.camera.on(event, first)
        fixture.camera.on(event, params => received.push(params.ObjectHandle))
        fixture.deliver(7)
        fixture.deliver(8)
        expect(received).toEqual([7, 8])
    })
    it('does not deliver an in-progress event to a newly registered observer', () => {
        const fixture = camera(),
            received: number[] = []
        const event = genericEventRegistry.ObjectAdded
        const second = (params: { ObjectHandle: number }) => received.push(params.ObjectHandle)
        const first = () => {
            fixture.camera.off(event, first)
            fixture.camera.on(event, second)
        }
        fixture.camera.on(event, first)
        fixture.deliver(7)
        fixture.deliver(8)
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
        on: (event, listener) => {
            listeners.set(event.name, listener)
        },
        off: event => {
            listeners.delete(event.name)
        },
        pollEvents: async () => {
            listeners.get('ObjectAdded')?.({ ObjectHandle: 123, private: 'secret' })
        },
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
        on: (event, listener) => {
            listeners.set(event.name, listener)
        },
        off: event => {
            listeners.delete(event.name)
        },
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
