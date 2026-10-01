import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// ExposureMeteringMode (0x500b) on Sony bodies. The ILCE-6700 advertises
// 0x8001-0x8006; names were verified on the darkgrade-testbench by driving each
// CrMeteringMode through the Sony Camera Remote SDK and reading back the PTP value.
describe('Sony ExposureMeteringMode (0x500b) decode', () => {
    const registry = createSonyRegistry(true)
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0x500b)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    const decode = (raw: number) => codec.decode(registry.codecs.uint16.encode(raw)).value

    it('decodes the six SDK-verified metering modes', () => {
        expect(decode(0x8001)).toBe('Multi')
        expect(decode(0x8002)).toBe('Center')
        expect(decode(0x8003)).toBe('Entire Screen Avg.')
        expect(decode(0x8004)).toBe('Spot: Standard')
        expect(decode(0x8005)).toBe('Spot: Large')
        expect(decode(0x8006)).toBe('Highlight')
    })

    it('falls back readably for unknown modes instead of showing a bare integer', () => {
        expect(decode(0x8009)).toBe('Mode 0x8009')
    })

    it('round-trips a known mode through encode', () => {
        expect([...codec.encode('Spot: Standard')]).toEqual([0x04, 0x80])
    })
})
