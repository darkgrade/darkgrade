import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

// Codes mapped from the Camera Remote SDK's PTP-code table and confirmed on the
// darkgrade-testbench ILCE-6700: both read the same raw values as the SDK.
const registry = createSonyRegistry(true)
function codecFor(code: number) {
    const definition = Object.values(registry.properties).find(candidate => candidate.code === code)!
    return typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
}

describe('Sony DeviceOverheatingState (0xd251)', () => {
    const codec = codecFor(0xd251)
    it('decodes the thermal states', () => {
        expect(codec.decode(new Uint8Array([0x00])).value).toBe('Not Overheating')
        expect(codec.decode(new Uint8Array([0x01])).value).toBe('Pre-Overheating')
        expect(codec.decode(new Uint8Array([0x02])).value).toBe('Overheating')
    })
})

describe('Sony UsbPowerSupply (0xd150)', () => {
    const codec = codecFor(0xd150)
    it('decodes the value the bench body reported after USB power was turned off', () => {
        expect(codec.decode(new Uint8Array([0x01])).value).toBe('Off')
        expect(codec.decode(new Uint8Array([0x02])).value).toBe('On')
    })
    it('encodes Off as 0x01', () => {
        expect([...(codec as { encode(value: string): Uint8Array }).encode('Off')]).toEqual([0x01])
    })
})
