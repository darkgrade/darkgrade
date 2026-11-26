import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { VendorEntry } from '@vendors/vendor-entry'
import { createSigmaRegistry } from '@vendors/registry'

export const sigmaVendor: VendorEntry = {
    vendorId: VendorIDs.SIGMA,
    make: 'Sigma',
    registry: createSigmaRegistry,
    driver: 'extension',
}
