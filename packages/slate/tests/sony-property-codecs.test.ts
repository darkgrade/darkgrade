import { createSonyRegistry } from '@vendors/registry'
import { describe, expect, it } from 'vitest'

// Each value below was verified on the darkgrade-testbench ILCE-6700 against the Sony Camera
// Remote SDK: ExposureBiasCompensation in thousandths of a stop, FocusArea Wide/Flexible Spot S,
// every CrMeteringMode and CrFlashMode read back as PTP, and the SDK's PTP-code table for
// DeviceOverheatingState and USBPowerSupply.
const registry = createSonyRegistry(true)
const width = { 0x5010: 'int16', 0xd22c: 'uint16', 0x500b: 'uint16', 0x500c: 'uint16', 0xd251: 'uint8', 0xd150: 'uint8' } as const
/** The camera layer's resolution: the first property with the code. */
function codecFor(code: keyof typeof width) {
    const definition = Object.values(registry.properties).find(candidate => candidate.code === code)!
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    return {
        name: definition.name,
        decode: (raw: number) => codec.decode(registry.codecs[width[code]].encode(raw)).value,
        encode: (value: string) => [...(codec as { encode(value: string): Uint8Array }).encode(value)],
    }
}

describe('Sony property codecs', () => {
    it.each([
        [0x5010, 0, '+0 EV'],
        [0x5010, 3000, '+3 EV'],
        [0x5010, 300, '+0.3 EV'],
        [0x5010, -700, '-0.7 EV'],
        [0x5010, -5000, '-5 EV'],
        [0xd22c, 0x0001, 'Wide'],
        [0xd22c, 0x0101, 'Flexible Spot S'],
        [0xd22c, 0x0999, 'Area 0x999'],
        [0x500b, 0x8001, 'Multi'],
        [0x500b, 0x8002, 'Center'],
        [0x500b, 0x8003, 'Entire Screen Avg.'],
        [0x500b, 0x8004, 'Spot: Standard'],
        [0x500b, 0x8005, 'Spot: Large'],
        [0x500b, 0x8006, 'Highlight'],
        [0x500b, 0x8009, 'Mode 0x8009'],
        [0x500c, 0x0003, 'Fill'],
        [0x500c, 0x8001, 'Slow sync'],
        [0x500c, 0x8003, 'Rear sync'],
        [0x500c, 0x0001, 'Auto'],
        [0x500c, 0x0002, 'Off'],
        [0xd251, 0x00, 'Not Overheating'],
        [0xd251, 0x01, 'Pre-Overheating'],
        [0xd251, 0x02, 'Overheating'],
        [0xd150, 0x01, 'Off'],
        [0xd150, 0x02, 'On'],
    ] as const)('property %i decodes %i as %s', (code, raw, label) => {
        expect(codecFor(code).decode(raw)).toBe(label)
    })

    it.each([
        [0xd22c, 'Flexible Spot S', [0x01, 0x01]],
        [0x500b, 'Spot: Standard', [0x04, 0x80]],
        [0x500c, 'Rear sync', [0x03, 0x80]],
        [0xd150, 'Off', [0x01]],
    ] as const)('property %i encodes %s', (code, label, bytes) => {
        expect(codecFor(code).encode(label)).toEqual(bytes)
    })

    it('resolves 0x5010 to the EV codec rather than the generic raw integer', () => {
        expect(codecFor(0x5010).name).toBe('ExposureBiasCompensation')
    })

    it('refuses to name an unknown flash mode, so descriptors report it as unrecognized', () => {
        expect(() => codecFor(0x500c).decode(0x8005)).toThrow('Invalid enum value')
    })
})
