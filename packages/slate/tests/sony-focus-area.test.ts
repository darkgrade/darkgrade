import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// FocusArea (0xd22c). Wide=0x0001 and Flexible Spot S=0x0101 were verified on the
// darkgrade-testbench against the Sony Camera Remote SDK on the ILCE-6700.
describe('Sony FocusArea (0xd22c) codec', () => {
    const registry = createSonyRegistry(true)
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0xd22c)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    const decode = (raw: number) => codec.decode(registry.codecs.uint16.encode(raw)).value

    it('decodes the verified areas', () => {
        expect(decode(0x0001)).toBe('Wide')
        expect(decode(0x0101)).toBe('Flexible Spot S')
    })

    it('encodes Flexible Spot S for tap-to-focus (little-endian 0x0101)', () => {
        expect([...codec.encode('Flexible Spot S')]).toEqual([0x01, 0x01])
    })

    it('falls back readably for unknown areas', () => {
        expect(decode(0x0999)).toBe('Area 0x999')
    })
})
