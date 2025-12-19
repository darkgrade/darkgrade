import { readFileSync } from 'fs'
import { getSubclassName } from './usb-ids/usb-class-codes'

interface USBIDsData {
    vendors: Array<{
        id: string
        name: string
        devices: Array<{ id: string; name: string }>
    }>
    version?: string
    date?: string
}

interface DeviceInfo {
    vendorId: number
    productId: number
    manufacturer?: string
    model?: string
    classCode?: number
    subclassCode?: number
}

let usbIdsCache: USBIDsData | null = null
let supplementalCache: USBIDsData | null = null

function loadUSBIds(): USBIDsData | null {
    if (usbIdsCache) return usbIdsCache
    try {
        const data = readFileSync('./src/transport/usb/usb-ids/usb-ids.json', 'utf-8')
        usbIdsCache = JSON.parse(data)
        return usbIdsCache
    } catch (e) {
        return null
    }
}

function loadSupplemental(): USBIDsData | null {
    if (supplementalCache) return supplementalCache
    try {
        const data = readFileSync('./src/transport/usb/usb-ids/usb-ids-supplemental.json', 'utf-8')
        supplementalCache = JSON.parse(data)
        return supplementalCache
    } catch (e) {
        return null
    }
}

function lookupVendor(vendorId: number, deviceVendorName?: string): string | undefined {
    const vendorIdHex = `0x${vendorId.toString(16).padStart(4, '0')}`

    // Priority 3 (highest): supplemental JSON
    const supplemental = loadSupplemental()
    if (supplemental) {
        const vendor = supplemental.vendors.find(v => v.id === vendorIdHex)
        if (vendor) return vendor.name
    }

    // Priority 2: device-provided name
    if (deviceVendorName) return deviceVendorName

    // Priority 1 (lowest): programmatic JSON
    const data = loadUSBIds()
    if (!data) return undefined
    return data.vendors.find(v => v.id === vendorIdHex)?.name
}

function lookupDevice(vendorId: number, productId: number, deviceProductName?: string): string | undefined {
    const vendorIdHex = `0x${vendorId.toString(16).padStart(4, '0')}`
    const productIdHex = `0x${productId.toString(16).padStart(4, '0')}`

    // Priority 3 (highest): supplemental JSON
    const supplemental = loadSupplemental()
    if (supplemental) {
        const vendor = supplemental.vendors.find(v => v.id === vendorIdHex)
        const device = vendor?.devices.find(d => d.id === productIdHex)
        if (device) return device.name
    }

    // Priority 2: device-provided name
    if (deviceProductName) return deviceProductName

    // Priority 1 (lowest): programmatic JSON
    const data = loadUSBIds()
    if (!data) return undefined
    const vendor = data.vendors.find(v => v.id === vendorIdHex)
    return vendor?.devices.find(d => d.id === productIdHex)?.name
}

export function formatDeviceTable(devices: DeviceInfo[]): string {
    if (devices.length === 0) {
        return '[USB] No USB devices found'
    }

    const sortedDevices = [...devices].sort((a, b) => {
        const vidDiff = a.vendorId - b.vendorId
        if (vidDiff !== 0) return vidDiff
        return a.productId - b.productId
    })

    const header = `${'VID'.padEnd(10)} ${'Vendor'.padEnd(26)} ${'PID'.padEnd(10)} ${'Product'.padEnd(26)} USB Device Class`
    const separator = '-'.repeat(94)
    const rows = sortedDevices.map(d => {
        const vid = '0x' + d.vendorId.toString(16).padStart(4, '0')
        const pid = '0x' + d.productId.toString(16).padStart(4, '0')
        const vendor = (lookupVendor(d.vendorId, d.manufacturer) || 'Unknown').substring(0, 24)
        const product = (lookupDevice(d.vendorId, d.productId, d.model) || 'Unknown').substring(0, 24)
        const subclassName = getSubclassName(d.classCode, d.subclassCode)
        return `${vid.padEnd(10)} ${vendor.padEnd(26)} ${pid.padEnd(10)} ${product.padEnd(26)} ${subclassName}`
    })

    return `[USB] Found ${devices.length} USB devices:\n${header}\n${separator}\n${rows.join('\n')}`
}
