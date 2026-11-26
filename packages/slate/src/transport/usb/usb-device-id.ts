/** A USB device as people type it: vendor and product id in hexadecimal, and optionally its serial number. */
export interface UsbDeviceId {
    vendorId: number
    productId: number
    serialNumber?: string
}

const hexadecimal = (value: number) => value.toString(16).padStart(4, '0')

/** `vvvv:pppp`, followed by `:SERIAL` when the device has one and `withSerial` is set. */
export function formatUsbDeviceId(device: UsbDeviceId, withSerial = false): string {
    const id = `${hexadecimal(device.vendorId)}:${hexadecimal(device.productId)}`
    return withSerial && device.serialNumber ? `${id}:${device.serialNumber}` : id
}

/** Reads `vvvv:pppp` (four hexadecimal digits each), and `:SERIAL` after it when `withSerial` is set; undefined when it is not one. */
export function parseUsbDeviceId(text: string, withSerial = false): UsbDeviceId | undefined {
    const match = /^([0-9a-f]{4}):([0-9a-f]{4})(?::(.+))?$/i.exec(text)
    if (!match || (match[3] !== undefined && !withSerial)) return undefined
    return {
        vendorId: Number.parseInt(match[1]!, 16),
        productId: Number.parseInt(match[2]!, 16),
        ...(match[3] !== undefined && { serialNumber: match[3] }),
    }
}
