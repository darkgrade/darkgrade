import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createFujifilmRegistry } from '@vendors/registry'

export const fujifilmVendor: VendorEntry = {
    vendorId: VendorIDs.FUJIFILM,
    make: 'Fujifilm',
    registry: createFujifilmRegistry,
    driver: 'extension',
}
