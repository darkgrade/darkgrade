import { Camera } from '@camera/index'
import { createPTPRegistry } from '@vendors/registry'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

describe('property descriptor integrity', () => {
    const registry = createPTPRegistry(true)
    const exposure = registry.properties.ExposureTime.codec(registry)

    it('preserves camera exposure ticks through display and restoration', () => {
        for (const ticks of [1, 2, 3, 80, 156, 2000, 3333, 6667, 12500, 13333, 300001, 0xffffffff]) {
            const wire = registry.codecs.uint32.encode(ticks)
            expect(exposure.encode(exposure.decode(wire).value), `ticks ${ticks}`).toEqual(wire)
        }
        expect(registry.codecs.uint32.decode(exposure.encode('1.5/2')).value).toBe(7500)
        expect(exposure.decode(registry.codecs.uint32.encode(80)).value).toBe('1/125')
    })

    it.each(['0', '-1', '1/0', '1/2/3', '1garbage', 'NaN', 'Infinity', '500000', '0.000001'])(
        'rejects invalid exposure %s before any camera write', async value => {
            const camera = protocolSession(new Camera({
                vendorId: 0x04b0,
                transport: { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
                logger: { captureConsole: false, renderInTerminal: false },
            })).driver
            const send = vi.spyOn(camera, 'send')
            await expect(camera.set(camera.registry.properties.ExposureTime, value)).rejects.toThrow('exposure time')
            expect(send).not.toHaveBeenCalled()
        }
    )

})
