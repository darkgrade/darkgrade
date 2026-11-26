/** The most codes Slate accepts from one Nikon GetVendorCodes (0x9439) answer. */
export const NIKON_VENDOR_CODES_MAXIMUM = 4096

/**
 * The codes in a GetVendorCodes answer: a UINT32 count, then that many UINT32 codes, in the
 * camera's order. Undefined when the array is shorter or longer than its count, or over the maximum.
 */
export function decodeNikonVendorCodes(bytes: Uint8Array, littleEndian = true): number[] | undefined {
    if (bytes.length < 4) return undefined
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const count = view.getUint32(0, littleEndian)
    if (count > NIKON_VENDOR_CODES_MAXIMUM || bytes.length !== 4 + count * 4) return undefined
    return Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, littleEndian))
}
