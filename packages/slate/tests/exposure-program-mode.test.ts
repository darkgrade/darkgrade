import { createPTPRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// ExposureProgramMode (0x500e) decoding. Values verified against the Sony Camera
// Remote SDK on the ILCE-6700 (raw 1 = Manual) via the darkgrade-testbench.
describe('ExposureProgramMode codec', () => {
    const registry = createPTPRegistry(true)
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0x500e)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    const decode = (raw: number) => codec.decode(registry.codecs.uint16.encode(raw)).value

    it('decodes the PASM modes', () => {
        expect(decode(1)).toBe('Manual')
        expect(decode(2)).toBe('Program Auto')
        expect(decode(3)).toBe('Aperture Priority')
        expect(decode(4)).toBe('Shutter Priority')
    })

    it('falls back readably for unknown/vendor modes instead of throwing', () => {
        expect(decode(0x9999)).toBe('Mode 0x9999')
    })

    it('round-trips a known mode through encode', () => {
        expect([...codec.encode('Manual')]).toEqual([1, 0])
    })
})
