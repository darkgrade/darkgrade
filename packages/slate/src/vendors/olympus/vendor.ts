import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createOlympusRegistry } from '@vendors/registry'

export const olympusVendor: VendorEntry = {
    vendorId: VendorIDs.OLYMPUS,
    make: 'Olympus',
    registry: createOlympusRegistry,
    driver: 'extension',
}

/** OM Digital Solutions' OM System bodies use Olympus's PTP extension. */
export const omDigitalVendor: VendorEntry = { ...olympusVendor, vendorId: VendorIDs.OM_DIGITAL, make: 'OM System' }
