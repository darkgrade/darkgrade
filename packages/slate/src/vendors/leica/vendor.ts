import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createLeicaRegistry } from '@vendors/registry'

export const leicaVendor: VendorEntry = {
    vendorId: VendorIDs.LEICA,
    make: 'Leica',
    registry: createLeicaRegistry,
    driver: 'extension',
}
