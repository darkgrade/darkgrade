import { validateCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import {
    descriptorAcceptsValue,
    encodeValue,
    readDescriptorLayout,
    valueLength,
} from '@transport/simulated/ptp-dataset-encoding'
import { describe, expect, it } from 'vitest'

const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
const minimalProfile = (): CameraProfile => ({
    schemaVersion: 1,
    id: 'validation-fixture',
    manufacturer: 'Fixture',
    line: 'Test',
    model: 'Fixture',
    provenance: {
        fidelity: 'documented',
        sources: [{ location: 'tests/camera-simulation/ptp-dataset-encoding.test.ts' }],
    },
    properties: [],
    exchanges: [],
    events: [],
    quirks: [],
})

describe('independent PTP dataset boundaries', () => {
    it('rejects integer overflow and precision loss rather than silently wrapping encoded values', () => {
        expect(() => encodeValue(0x0002, 256)).toThrow('bounds')
        expect(() => encodeValue(0x0002, -1)).toThrow('bounds')
        expect(() => encodeValue(0x0003, 32768)).toThrow('bounds')
        expect(() => encodeValue(0x0008, Number.MAX_SAFE_INTEGER + 1)).toThrow('safe integers')
        expect(encodeValue(0x0008, '18446744073709551615')).toEqual(bytes('ffffffffffffffff'))
        expect(encodeValue(0x0007, '-9223372036854775808')).toEqual(bytes('0000000000000080'))
        expect(encodeValue(0x000a, '340282366920938463463374607431768211455')).toEqual(
            bytes('ffffffffffffffffffffffffffffffff')
        )
        expect(() => encodeValue(0x000a, '340282366920938463463374607431768211456')).toThrow('bounds')
    })

    it('checks whole string and array values including lengths and UTF-16 termination', () => {
        expect(() => valueLength(0xffff, bytes('024100'), 0)).toThrow('Truncated')
        expect(() => valueLength(0xffff, bytes('0241004200'), 0)).toThrow('terminator')
        expect(valueLength(0xffff, bytes('0241000000'), 0)).toBe(5)
        const layout = readDescriptorLayout(bytes('0550044001000000000000000000'))
        expect(layout.currentValueEnd).toBe(13)
        expect(descriptorAcceptsValue(layout, bytes('0200000001000200'))).toBe(true)
        expect(descriptorAcceptsValue(layout, bytes('020000000100'))).toBe(false)
        expect(descriptorAcceptsValue(layout, bytes('0000000000'))).toBe(false)
    })

    it('rejects truncated descriptor defaults, current values, forms and enumerations', () => {
        for (const raw of [
            '05500400',
            '05500400010200',
            '055004000102000200',
            '05500400010200020001',
            '0550040001020002000202000200',
            '05500400020200020000',
        ]) {
            expect(() => readDescriptorLayout(bytes(raw)), raw).toThrow()
        }
    })

    it('compares signed 64-bit ranges without rounding through JavaScript numbers', () => {
        const layout = readDescriptorLayout(
            bytes(
                '0f50070001' +
                    '0000000000000000'.repeat(2) +
                    '01' +
                    '0000000000000080' +
                    'ffffffffffffff7f' +
                    '0000000000000000'
            )
        )
        expect(layout.range).toEqual({ minimum: -9223372036854775808n, maximum: 9223372036854775807n, step: 0n })
        expect(descriptorAcceptsValue(layout, bytes('ffffffffffffff7f'))).toBe(true)
        expect(descriptorAcceptsValue(layout, bytes('0000000000000080'))).toBe(true)
        expect(descriptorAcceptsValue(layout, bytes('ffffffffffffffff00'))).toBe(false)
    })
})

describe('profile validation on untrusted JSON shapes', () => {
    it.each([
        { provenance: { fidelity: 'documented', sources: {} } },
        { properties: {} },
        { properties: [null] },
        { properties: [{ descriptor: { form: [] } }] },
        { exchanges: [null] },
        { exchanges: [{ response: [] }] },
        { events: [null] },
        { quirks: [null] },
        { quirks: [{ behaviour: [] }] },
        { catalog: [] },
        { deviceInfo: [] },
        { deviceInfo: { listsComplete: 'false' } },
        {
            quirks: [
                {
                    id: 'reference',
                    description: 'bad boolean',
                    source: 0,
                    unverified: 'false',
                    behaviour: { kind: 'none' },
                },
            ],
        },
        { usb: { productIds: {} } },
    ])('returns actionable validation errors without throwing for %j', malformed => {
        const validate = () => validateCameraProfile({ ...minimalProfile(), ...malformed })
        expect(validate).not.toThrow()
        expect(validate().length).toBeGreaterThan(0)
    })

    it('rejects oversized wire codes and invalid descriptor scalar values before simulation', () => {
        const profile = minimalProfile()
        profile.usb = { vendorId: '0x10000', productIds: ['0x1'] }
        expect(validateCameraProfile(profile).some(problem => problem.includes('UINT16'))).toBe(true)
        profile.usb = undefined
        profile.properties = [
            {
                code: '0x5001',
                source: 0,
                descriptor: {
                    dataType: '0x0002',
                    writable: true,
                    factoryDefault: 0,
                    current: 256,
                },
            },
        ]
        expect(validateCameraProfile(profile).some(problem => problem.includes('datatype bounds'))).toBe(true)
        profile.properties[0].descriptor!.current = 'not-an-integer'
        expect(validateCameraProfile(profile).some(problem => problem.includes('not an integer'))).toBe(true)
    })

    it('accepts only an explicit nonempty catalog model association', () => {
        const profile = minimalProfile()
        profile.catalog = { manufacturer: 'Fixture', line: 'Test', model: 'Known model' }
        expect(validateCameraProfile(profile)).toEqual([])
        profile.catalog.model = ''
        expect(validateCameraProfile(profile)).toContain('catalog.model must be a nonempty string')
    })
})
