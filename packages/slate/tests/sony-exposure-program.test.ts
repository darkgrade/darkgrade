import { describe, expect, it } from 'vitest'
import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { createSonyRegistry } from '@ptp/registry'
import { SonyExposureProgramCodec } from '@vendors/sony/exposure-program'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

describe('Sony descriptor-sized exposure mode writes', () => {
    it.each([4, 6])('writes the advertised datatype %s and confirms all bits in readback', async datatype => {
        const initial = datatype === 6 ? 0x00078090 : 0x8090
        const target = datatype === 6 ? 0x00010002 : 2
        let current = initial
        const payloads: Uint8Array[] = []
        const registry = createSonyRegistry(true)
        const codec = new SonyExposureProgramCodec(registry, datatype)
        const descriptor = () => ({
            devicePropertyCode: 0x500e, dataType: datatype,
            currentValueRaw: current, currentValueDecoded: codec.decode(codec.encode(current === initial ? 'Movie Flexible Exposure' : 'Program Auto')).value,
            supportedValuesRaw: [initial, target], supportedValuesDecoded: ['Movie Flexible Exposure', 'Program Auto'],
            sonyGetSetFlag: 1, sonyEnabledFlag: 1, vendorExtensions: { enabled: true },
        })
        const camera = new SonyCamera({ isLittleEndian: () => true } as TransportInterface,
            new Logger({ captureConsole: false, renderInTerminal: false }))
        camera.send = (async (operation, parameters: any, payload?: Uint8Array) => {
            if (operation.name === 'SDIO_GetAllExtDevicePropInfo')
                return { code: 0x2001, data: { properties: [descriptor()] } }
            if (operation.name === 'SDIO_GetExtDevicePropValue')
                return { code: 0x2001, data: parameters.DevicePropCode === 0x500e ? descriptor() : { currentValueDecoded: 0 } }
            if (operation.name === 'SDIO_SetExtDevicePropValue') {
                payloads.push(payload!)
                current = datatype === 6 ? registry.codecs.uint32.decode(payload!).value : registry.codecs.uint16.decode(payload!).value
            }
            return { code: 0x2001 }
        }) as typeof camera.send
        await camera.set(camera.registry.properties.ExposureProgramMode, 'Program Auto')
        expect(payloads[0]?.length).toBe(datatype === 6 ? 4 : 2)
        expect(current).toBe(target)
        await camera.set(camera.registry.properties.ExposureProgramMode, 'Movie Flexible Exposure')
        expect(current).toBe(initial)
    })
    it('round trips unknown full-width values and rejects truncation', () => {
        const registry = createSonyRegistry(true)
        const wide = new SonyExposureProgramCodec(registry, 6)
        expect(wide.decode(wide.encode('Mode 0x12348090')).value).toBe('Mode 0x12348090')
        expect(() => new SonyExposureProgramCodec(registry, 4).encode('Mode 0x12348090')).toThrow('out-of-range')
    })
})
