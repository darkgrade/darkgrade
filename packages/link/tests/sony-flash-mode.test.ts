import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// FlashMode (0x500c) on Sony bodies. Verified on the darkgrade-testbench by setting
// each value through the Sony SDIO path and reading back the SDK's CrFlashMode:
// 0x0003=Fill (SDK 3), 0x8001=Slow Sync (SDK 5), 0x8003=Rear Sync (SDK 6).
describe('Sony FlashMode (0x500c) decode', () => {
    const registry = createSonyRegistry(true)
    const definition = Object.values(registry.properties).find(candidate => candidate.code === 0x500c)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    const decode = (raw: number) => codec.decode(registry.codecs.uint16.encode(raw)).value

    it('decodes the SDK-verified vendor flash modes', () => {
        expect(decode(0x0003)).toBe('Fill-flash')
        expect(decode(0x8001)).toBe('Slow Sync')
        expect(decode(0x8003)).toBe('Rear Sync')
    })

    it('labels the standard low-range modes', () => {
        expect(decode(0x0001)).toBe('Autoflash')
        expect(decode(0x0002)).toBe('Flash Off')
    })

    it('falls back readably for unknown modes', () => {
        expect(decode(0x8005)).toBe('Mode 0x8005')
    })

    it('round-trips a known mode through encode', () => {
        expect([...codec.encode('Rear Sync')]).toEqual([0x03, 0x80])
    })
})
