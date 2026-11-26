import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createCanonRegistry } from '@vendors/registry'

export const canonVendor: VendorEntry = {
    vendorId: VendorIDs.CANON,
    make: 'Canon',
    registry: createCanonRegistry,
    driver: 'dedicated',
    manufacturer: /^\s*canon\b/i,
    lensMount: model => (/\bEOS R(\d|P\b|\b)/i.test(model) ? 'RF' : undefined),
}
