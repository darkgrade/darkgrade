import { createCanonRegistry, createNikonRegistry, createPTPRegistry, createSonyRegistry } from '@ptp/registry'
import type { PropertyDefinition } from '@ptp/types/property'

export const captureRegistry = (vendorId: number) =>
    vendorId === 0x04a9
        ? createCanonRegistry(true)
        : vendorId === 0x054c
          ? createSonyRegistry(true)
          : vendorId === 0x04b0
            ? createNikonRegistry(true)
            : createPTPRegistry(true)

/** Only defined numeric control properties are retained; no device-owned free text or network state. */
export function capturePropertyCodes(vendorId: number): Set<number> {
    return new Set(
        Object.values(captureRegistry(vendorId).properties)
            .filter(
                (property: PropertyDefinition) =>
                    property.datatype >= 1 &&
                    property.datatype <= 10 &&
                    !/serial|owner|artist|copyright|network|wireless|wifi|ssid|password|authentication|fingerprint|address|host|gps|location|DateTime|TimeZone|Clock|name/i.test(
                        property.name
                    )
            )
            .map(property => property.code)
    )
}
