import { createSonyRegistry } from '@vendors/registry'
import { sonyFallbackPropertyName } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import { describe, expect, it } from 'vitest'

// Each value below was verified on the darkgrade-testbench ILCE-6700 against the Sony Camera
// Remote SDK: ExposureBiasCompensation in thousandths of a stop, FocusArea Wide/Flexible Spot S,
// every CrMeteringMode and CrFlashMode read back as PTP, and the SDK's PTP-code table for
// DeviceOverheatingState and USBPowerSupply.
const registry = createSonyRegistry(true)
const width = { 0x5010: 'int16', 0xd22c: 'uint16', 0x500b: 'uint16', 0x500c: 'uint16', 0xd251: 'uint8', 0xd150: 'uint8' } as const
type StringCodec = { encode(value: string): Uint8Array; decode(bytes: Uint8Array): { value: unknown } }

function resolveCodec(definition: (typeof registry.properties)[keyof typeof registry.properties]): StringCodec {
    const codec = typeof definition.codec === 'function' ? definition.codec(registry) : definition.codec
    return codec as StringCodec
}

/** The camera layer's resolution: the first property with the code. */
function codecFor(code: keyof typeof width) {
    const definition = Object.values(registry.properties).find(candidate => candidate.code === code)!
    const codec = resolveCodec(definition)
    return {
        decode: (raw: number) => codec.decode(registry.codecs[width[code]].encode(raw)).value,
        encode: (value: string) => [...codec.encode(value)],
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
    ] as const)('property %i decodes %i as %s and encodes it back', (code, raw, label) => {
        const codec = codecFor(code)
        expect(codec.decode(raw)).toBe(label)
        if (label.startsWith('Area ') || label.startsWith('Mode ')) return
        expect(codec.encode(label)).toEqual([...registry.codecs[width[code]].encode(raw)])
    })

    it('refuses to name an unknown flash mode, so descriptors report it as unrecognized', () => {
        expect(() => codecFor(0x500c).decode(0x8005)).toThrow('Invalid enum value')
    })

    it('round trips extended ISO and NR bits without treating them as sensitivity', () => {
        const codec = resolveCodec(registry.properties.Iso)
        for (const [raw, label] of [[0x10000032, 'ISO 50 (extended)'], [0x1000fa00, 'ISO 64000 (extended)'], [0x01000190, 'Multi Frame NR ISO 400'], [0x12000190, 'Multi Frame NR High ISO 400 (extended)']] as const) {
            const bytes = new Uint8Array(4)
            new DataView(bytes.buffer).setUint32(0, raw, true)
            expect(codec.decode(bytes).value).toBe(label)
            expect(codec.encode(label)).toEqual(bytes)
        }
    })

    it.each([
        ['Aperture', '3.5', 'f/3.5'],
        ['Aperture', 'f/4', 'f/4'],
        ['Aperture', 'f5.6', 'f/5.6'],
        ['Aperture', 'f 8', 'f/8'],
        ['Aperture', 'ƒ/11', 'f/11'],
        ['Aperture', 'F:16', 'f/16'],
        ['Aperture', '11', 'f/11'],
        ['Iso', '100', 'ISO 100'],
        ['Iso', 'ISO 200', 'ISO 200'],
        ['Iso', '00800', 'ISO 800'],
        ['Iso', '01600', 'ISO 1600'],
        ['Iso', 'auto', 'ISO AUTO'],
        ['Iso', 'Auto', 'ISO AUTO'],
        ['Iso', 'ISO AUTO', 'ISO AUTO'],
        ['Iso', '3200', 'ISO 3200'],
        ['ShutterSpeed', '30', '30"'],
        ['ShutterSpeed', '15s', '15"'],
        ['ShutterSpeed', '8"', '8"'],
        ['ShutterSpeed', "4'", '4"'],
        ['ShutterSpeed', '2sec', '2"'],
        ['ShutterSpeed', '1 seconds', '1"'],
        ['ShutterSpeed', '1/4s', '1/4'],
        ['ShutterSpeed', '1/8', '1/8'],
        ['ShutterSpeed', '1/125', '1/125'],
        ['ShutterSpeed', '1/4000', '1/4000'],
        ['ShutterSpeed', 'bulb', 'BULB'],
        ['ShutterSpeed', 'BULB', 'BULB'],
        ['ShutterSpeed', 'b', 'BULB'],
        ['ShutterSpeed', 'B', 'BULB'],
        ['ShutterSpeed', '0.4"', '0.4"'],
        ['ShutterSpeed', '0.6', '0.6"'],
        ['ShutterSpeed', '0.8s', '0.8"'],
        ['ShutterSpeed', '2.5"', '2.5"'],
    ] as const)('%s parses %j as %s', (name, input, label) => {
        const codec = resolveCodec(registry.properties[name])
        expect(codec.decode(codec.encode(input)).value).toBe(label)
    })

    it.each([
        // The bench body reported "E PZ 16-50mm F3.5-5.6 OSS II" for 0xd07b.
        [0xd07b, 'LensModelName'],
        // 0xd20e is Sony's BatteryLevel, but the standard PTP BatteryLevel (0x5001) owns that name.
        [0xd20e, 'Unknown_0xd20e'],
        [0xd9ff, 'Unknown_0xd9ff'],
    ] as const)('names undefined property %i %s', (code, name) => {
        expect(sonyFallbackPropertyName(code, registry).name).toBe(name)
    })
})
