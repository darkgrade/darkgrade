import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// ExposureBiasCompensation (0x5010). The ILCE-6700 advertises this property in
// thousandths of a stop (300 = +0.3 EV, 3000 = +3.0 EV, verified against the
// camera's own advertised value set via the darkgrade-testbench). The generic
// 0x5010 definition decodes a plain int16, so the Sony registry overrides it to
// decode EV. This test pins the find-by-code resolution the camera layer uses.
describe('Sony ExposureBiasCompensation (0x5010) EV decode', () => {
    const registry = createSonyRegistry(true)
    // Replicate the camera layer's resolution: first property matching the code.
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0x5010)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    const decode = (raw: number) => codec.decode(registry.codecs.int16.encode(raw)).value

    it('resolves 0x5010 to the EV codec, not the generic raw-int codec', () => {
        expect(definition.name).toBe('ExposureBiasCompensation')
        expect(decode(0)).toBe('+0 EV')
        expect(decode(3000)).toBe('+3 EV')
        expect(decode(300)).toBe('+0.3 EV')
        expect(decode(-700)).toBe('-0.7 EV')
        expect(decode(-5000)).toBe('-5 EV')
    })
})
