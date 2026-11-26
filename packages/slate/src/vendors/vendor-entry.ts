import type { Registry, VendorOperationRegistry } from '@vendors/registry'

interface VendorFacts {
    vendorId: number
    /** The make people use ("Sony", "OM System"), reported in place of DeviceInfo's manufacturer. */
    make: string
    /** DeviceInfo's Manufacturer for this vendor's bodies, where a vendor-less driver judges an inventory by it. */
    manufacturer?: RegExp
    /** The lens mount a model name implies; undefined when it implies none (never a guess). */
    lensMount?(model: string): string | undefined
}

/**
 * What Slate knows about one USB camera vendor. Each brand folder supplies its own (`<brand>/vendor.ts`);
 * `vendors.ts` lists them. A `dedicated` vendor has a driver of its own; an `extension` vendor is served by
 * the generic driver with its registry's cited operations.
 */
export type VendorEntry = VendorFacts &
    (
        | { driver: 'dedicated'; registry(littleEndian: boolean): Registry }
        | { driver: 'extension'; registry(littleEndian: boolean): VendorOperationRegistry }
    )
