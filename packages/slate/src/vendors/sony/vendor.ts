import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createSonyRegistry } from '@vendors/registry'

export const sonyVendor: VendorEntry = {
    vendorId: VendorIDs.SONY,
    make: 'Sony',
    registry: createSonyRegistry,
    driver: 'dedicated',
    manufacturer: /^\s*sony\b/i,
    lensMount: model => (/^IL(CE|ME)-/i.test(model) ? 'E' : /^ILCA-/i.test(model) ? 'A' : undefined),
}
