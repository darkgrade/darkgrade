import { canonVendor } from '@vendors/canon/vendor'
import { fujifilmVendor } from '@vendors/fujifilm/vendor'
import { leicaVendor } from '@vendors/leica/vendor'
import { nikonVendor } from '@vendors/nikon/vendor'
import { olympusVendor, omDigitalVendor } from '@vendors/olympus/vendor'
import { panasonicVendor } from '@vendors/panasonic/vendor'
import { sigmaVendor } from '@vendors/sigma/vendor'
import { sonyVendor } from '@vendors/sony/vendor'
import type { VendorEntry } from '@vendors/vendor-entry'

/** Every vendor Slate knows, from each brand's own entry. Shared code reads this instead of testing vendor ids. */
export const vendorTable: readonly VendorEntry[] = [
    sonyVendor,
    canonVendor,
    nikonVendor,
    fujifilmVendor,
    panasonicVendor,
    olympusVendor,
    omDigitalVendor,
    leicaVendor,
    sigmaVendor,
]

const byId = new Map(vendorTable.map(entry => [entry.vendorId, entry]))

export function vendorEntry(vendorId: number | null | undefined): VendorEntry | undefined {
    return vendorId === null || vendorId === undefined ? undefined : byId.get(vendorId)
}

/** The vendor whose bodies report this DeviceInfo Manufacturer, among vendors that name one. */
export function vendorOfManufacturer(manufacturer: string): VendorEntry | undefined {
    return vendorTable.find(entry => entry.manufacturer?.test(manufacturer))
}
