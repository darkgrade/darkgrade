import type { PropertyDefinition } from '@ptp/types/property'
import { createPTPRegistry, type Registry } from '@vendors/registry'
import { vendorEntry } from '@vendors/vendors'

/** A dedicated vendor's definitions; the standard set for any other (an extension vendor's properties are not captured). */
export const captureRegistry = (vendorId: number): Registry => {
    const vendor = vendorEntry(vendorId)
    return vendor?.driver === 'dedicated' ? vendor.registry(true) : createPTPRegistry(true)
}

const privateProperty =
    /serial|owner|artist|copyright|network|wireless|wifi|ssid|password|authentication|fingerprint|address|host|gps|location|DateTime|TimeZone|Clock|name/i

/** Only defined numeric control properties are retained; no device-owned free text or network state. */
export function capturePropertyCodes(vendorId: number): Set<number> {
    return new Set(
        Object.values(captureRegistry(vendorId).properties)
            .filter((property: PropertyDefinition) => property.datatype >= 1 && property.datatype <= 10 && !privateProperty.test(property.name))
            .map(property => property.code)
    )
}
