import { Camera } from '@camera/index'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { createPTPRegistry } from '@ptp/registry'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

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
            const camera = new Camera({
                vendorId: 0x04b0,
                transport: { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
                logger: { captureConsole: false, renderInTerminal: false },
            }).getInstance()
            const send = vi.spyOn(camera, 'send')
            await expect(camera.set(camera.registry.properties.ExposureTime, value)).rejects.toThrow('exposure time')
            expect(send).not.toHaveBeenCalled()
        }
    )

    it('rejects corrupt access/form flags while preserving unknown enumeration values', () => {
        const codec = new DevicePropDescCodec(registry)
        // Independent UINT16 ISO descriptor: writable, default/current 100, enum [100, 123].
        const data = Uint8Array.from([0x0f, 0x50, 4, 0, 1, 100, 0, 100, 0, 2, 2, 0, 100, 0, 123, 0])
        expect(codec.decode(data).value.supportedValuesRaw).toEqual([100, 123])
        for (const [position, invalid] of [[4, 2], [9, 3], [9, 255]]) {
            const malformed = data.slice()
            malformed[position] = invalid
            expect(() => codec.decode(malformed)).toThrow('flag')
        }
        expect(() => codec.decode(data, -1)).toThrow('header')
        expect(() => codec.decode(data, 1.5)).toThrow('header')
        expect(() => codec.decode(data, data.length - 4)).toThrow('header')
    })
})
