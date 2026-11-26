import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createNikonRegistry } from '@vendors/registry'

export const nikonVendor: VendorEntry = {
    vendorId: VendorIDs.NIKON,
    make: 'Nikon',
    registry: createNikonRegistry,
    driver: 'dedicated',
    manufacturer: /^\s*nikon\b/i,
    lensMount: model => (/^Z\s?[0-9fc]/i.test(model) ? 'Z' : /^D\d/i.test(model) ? 'F' : undefined),
}
