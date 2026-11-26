import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createPanasonicRegistry } from '@vendors/registry'

export const panasonicVendor: VendorEntry = {
    vendorId: VendorIDs.PANASONIC,
    make: 'Panasonic',
    registry: createPanasonicRegistry,
    driver: 'extension',
}
