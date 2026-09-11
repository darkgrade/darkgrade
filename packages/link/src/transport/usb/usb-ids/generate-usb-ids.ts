import { writeFile } from 'fs/promises'

interface Device {
    id: string
    name: string
}

interface Vendor {
    id: string
    name: string
    devices: Device[]
}

interface USBIDsData {
    vendors: Vendor[]
    version: string
    date: string
}

async function fetchUSBIds(): Promise<string> {
    const response = await fetch('http://www.linux-usb.org/usb.ids')
    if (!response.ok) {
        throw new Error(`Failed to fetch USB IDs: ${response.statusText}`)
    }
    return response.text()
}

function parseData(data: string): USBIDsData {
    const obj: USBIDsData = { vendors: [], version: '', date: '' }
    let currentVendor: Vendor | null = null

    for (const line of data.split('\n')) {
        if (line.startsWith('# List of known device classes, subclasses and protocols')) {
            if (currentVendor) {
                obj.vendors.push(currentVendor)
            }
            break
        }

        const vendorMatch = line.match(/^([0-9a-f]{4})  (.+)$/)
        if (vendorMatch) {
            if (currentVendor) {
                obj.vendors.push(currentVendor)
            }
            currentVendor = makeVendor(vendorMatch[1], vendorMatch[2])
            continue
        }

        const deviceMatch = line.match(/^\t([0-9a-f]{4})  (.+)$/)
        if (deviceMatch && currentVendor) {
            currentVendor.devices.push(makeDevice(deviceMatch[1], deviceMatch[2]))
        } else if (line.startsWith('# Version: ')) {
            obj.version = line.split(': ')[1]
        } else if (line.startsWith('# Date: ')) {
            obj.date = line.split(':    ')[1]
        }
    }

    return obj
}

function makeVendor(id: string, name: string): Vendor {
    return { id: `0x${id}`, name, devices: [] }
}

function makeDevice(id: string, name: string): Device {
    return { id: `0x${id}`, name }
}

function lookupVendor(vendorId: number, data: USBIDsData): string | undefined {
    const vendorIdHex = `0x${vendorId.toString(16).padStart(4, '0')}`
    const vendor = data.vendors.find(v => v.id === vendorIdHex)
    return vendor?.name
}

function lookupDevice(vendorId: number, productId: number, data: USBIDsData): string | undefined {
    const vendorIdHex = `0x${vendorId.toString(16).padStart(4, '0')}`
    const productIdHex = `0x${productId.toString(16).padStart(4, '0')}`

    const vendor = data.vendors.find(v => v.id === vendorIdHex)
    if (!vendor) return undefined

    const device = vendor.devices.find(d => d.id === productIdHex)
    return device?.name
}

async function main() {
    console.log('Fetching USB IDs from linux-usb.org...')
    const data = await fetchUSBIds()

    console.log('Parsing USB IDs data...')
    const parsedData = parseData(data)

    console.log(`Found ${parsedData.vendors.length} vendors`)
    console.log(`Version: ${parsedData.version}`)
    console.log(`Date: ${parsedData.date}`)

    await writeFile('./src/transport/usb/usb-ids/usb-ids.json', JSON.stringify(parsedData, null, 2), 'utf-8')
    console.log('\nGenerated src/transport/usb/usb-ids/usb-ids.json')

    console.log('\nExample lookups:')
    console.log(`Vendor 0x04b8: ${lookupVendor(0x04b8, parsedData)}`)
    console.log(`Device 0x04b8:0x0202: ${lookupDevice(0x04b8, 0x0202, parsedData)}`)
}

main().catch(console.error)

export { fetchUSBIds, lookupDevice, lookupVendor, parseData }
export type { Device, USBIDsData, Vendor }
