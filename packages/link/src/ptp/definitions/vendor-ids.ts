export const VendorIDs = {
    SONY: 0x054c,
    CANON: 0x04a9,
    NIKON: 0x04b0,
    FUJIFILM: 0x04cb,
    PANASONIC: 0x04da,
    OLYMPUS: 0x07b4,
    /** OM Digital Solutions (OM System bodies); libgphoto2 library.c lists OM-1 Mark II as 0x33a2:0x0136. */
    OM_DIGITAL: 0x33a2,
    /** libgphoto2 library.c fixup_cached_deviceinfo selects the Leica extension for USB vendor 0x1a98. */
    LEICA: 0x1a98,
    /** libgphoto2 library.c fixup_cached_deviceinfo selects the Sigma fp extension for USB vendor 0x1003. */
    SIGMA: 0x1003,
} as const

export type VendorID = (typeof VendorIDs)[keyof typeof VendorIDs]

export const VendorNames: Record<VendorID, string> = {
    [VendorIDs.SONY]: 'Sony Group Corporation',
    [VendorIDs.CANON]: 'Canon Inc.',
    [VendorIDs.NIKON]: 'Nikon Corporation',
    [VendorIDs.FUJIFILM]: 'Fujifilm Corporation',
    [VendorIDs.PANASONIC]: 'Panasonic Corporation',
    [VendorIDs.OLYMPUS]: 'Olympus Corporation',
    [VendorIDs.OM_DIGITAL]: 'OM Digital Solutions',
    [VendorIDs.LEICA]: 'Leica Camera AG',
    [VendorIDs.SIGMA]: 'Sigma Corporation',
}

function isValidVendorID(vendorId: number): vendorId is VendorID {
    return vendorId in VendorNames
}

export function getVendorName(vendorId: number): string {
    return isValidVendorID(vendorId) ? VendorNames[vendorId] : 'Unknown Vendor'
}

export function isSupportedVendor(vendorId: number): boolean {
    const values: number[] = Object.values(VendorIDs)
    return values.includes(vendorId)
}
