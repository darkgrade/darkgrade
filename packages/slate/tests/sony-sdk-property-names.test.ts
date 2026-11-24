import { sonyFallbackPropertyName } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { SONY_SDK_PROPERTY_NAMES } from '@ptp/definitions/vendors/sony/sony-sdk-property-names'
import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

const registry = createSonyRegistry(true)

describe('Sony SDK property-name table', () => {
    it('agrees with codes Darkgrade verified independently on an ILCE-6700', () => {
        expect(SONY_SDK_PROPERTY_NAMES[0xd22c]).toBe('FocusArea')
        expect(SONY_SDK_PROPERTY_NAMES[0xd251]).toBe('DeviceOverheatingState')
        expect(SONY_SDK_PROPERTY_NAMES[0xd150]).toBe('USBPowerSupply')
    })

    it('labels undefined codes with the SDK name', () => {
        // The bench body reported "E PZ 16-50mm F3.5-5.6 OSS II" here.
        expect(sonyFallbackPropertyName(0xd07b, registry).name).toBe('LensModelName')
    })

    it('keeps Unknown_ when the SDK name belongs to another defined property', () => {
        // 0xd20e is Sony's BatteryLevel, but the standard PTP BatteryLevel (0x5001) owns that name.
        expect(SONY_SDK_PROPERTY_NAMES[0xd20e]).toBe('BatteryLevel')
        expect(sonyFallbackPropertyName(0xd20e, registry).name).toBe('Unknown_0xd20e')
    })

    it('keeps Unknown_ for codes the SDK does not name', () => {
        expect(sonyFallbackPropertyName(0xd9ff, registry).name).toBe('Unknown_0xd9ff')
    })
})
