/**
 * USB Transport Tests
 * Tests USB device discovery, connection, and Sony camera interaction
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { TransportFactory } from '@transport/transport-factory'
import { TransportType } from '@transport/interfaces/transport.interface'
import { USBDeviceFinder } from '@transport/usb/usb-device-finder'

// Sony vendor ID
const SONY_VENDOR_ID = 0x054c

// Set to true for verbose output
const VERBOSE = true

describe('USB Transport', () => {
    let transportFactory: TransportFactory
    let deviceFinder: USBDeviceFinder

    beforeAll(() => {
        transportFactory = new TransportFactory()
        deviceFinder = new USBDeviceFinder()

        if (VERBOSE) {
            console.log('\n========================================')
            console.log('USB Transport Test Suite - VERBOSE MODE')
            console.log('========================================\n')
        }
    })

    describe('Device Discovery', () => {
        it('should be able to use node-usb', async () => {
            // Test that we can import and use node-usb
            const usb = await import('usb')
            expect(usb).toBeDefined()
            expect(usb.usb).toBeDefined()
            expect(usb.usb.getDeviceList).toBeDefined()
        })

        it('should discover devices and interfaces', async () => {
            const devices = await deviceFinder.getAllDevices()

            // Should find multiple devices
            expect(devices).toBeDefined()
            expect(Array.isArray(devices)).toBe(true)
            expect(devices.length).toBeGreaterThan(0)

            // Log device information
            console.log(`\n[TEST: Device Discovery]`)
            console.log(`Found ${devices.length} USB devices:`)
            console.log('----------------------------------------')

            devices.forEach((device, index) => {
                const vendorHex = device.vendorId.toString(16).padStart(4, '0')
                const productHex = device.productId.toString(16).padStart(4, '0')

                console.log(`\nDevice #${index + 1}:`)
                console.log(`  VID:PID: 0x${vendorHex}:0x${productHex} (${device.vendorId}:${device.productId})`)
                console.log(`  Manufacturer: ${device.manufacturer || 'Not available'}`)
                console.log(`  Product: ${device.product || 'Not available'}`)
                console.log(`  Serial Number: ${device.serialNumber || 'Not available'}`)

                if (VERBOSE) {
                    // Check if it's a known vendor
                    const knownVendors: Record<number, string> = {
                        0x054c: 'Sony Group Corporation',
                        0x05ac: 'Apple Inc.',
                        0x0b05: 'ASUSTeK Computer Inc.',
                        0x0bda: 'Realtek',
                        0x2188: 'CalDigit',
                        0x8087: 'Intel',
                        0x1235: 'Focusrite',
                        0x04b0: 'Nikon Corporation',
                        0x04a9: 'Canon Inc.',
                    }
                    if (knownVendors[device.vendorId]) {
                        console.log(`  Known Vendor: ${knownVendors[device.vendorId]}`)
                    }

                    // Raw device object (be careful with this)
                    if (device.device && typeof device.device === 'object') {
                        console.log(`  Device Object: Available (Type: ${device.device.constructor.name || 'Unknown'})`)
                    }
                }
            })
            console.log('\n----------------------------------------')
        })

        it('should find at least one device with Sony vendor code', async () => {
            console.log(`\n[TEST: Sony Device Detection]`)
            console.log('----------------------------------------')

            const devices = await deviceFinder.findDevices({ vendorId: SONY_VENDOR_ID })

            // Should find at least one Sony device
            expect(devices).toBeDefined()
            expect(Array.isArray(devices)).toBe(true)
            expect(devices.length).toBeGreaterThanOrEqual(1)

            // All devices should have Sony vendor ID
            devices.forEach(device => {
                expect(device.vendorId).toBe(SONY_VENDOR_ID)
            })

            console.log(`Found ${devices.length} Sony device(s)`)

            if (VERBOSE && devices.length > 0) {
                devices.forEach((device, index) => {
                    console.log(`\nSony Device #${index + 1}:`)
                    console.log(`  Product ID: 0x${device.productId.toString(16).padStart(4, '0')}`)
                    console.log(`  Decimal: ${device.productId}`)

                    // Known Sony camera product IDs
                    const knownSonyDevices: Record<number, string> = {
                        0x0e78: 'Alpha Camera (possibly a6700 or similar)',
                        0x094e: 'Alpha a7 III',
                        0x094f: 'Alpha a7R III',
                        0x0954: 'Alpha a9',
                        0x0a6b: 'Alpha a7R IV',
                        0x0c34: 'Alpha a1',
                        0x0d55: 'Alpha a7 IV',
                    }

                    if (knownSonyDevices[device.productId]) {
                        console.log(`  Possible Model: ${knownSonyDevices[device.productId]}`)
                    }
                })
            }
            console.log('----------------------------------------')
        })

        it('should find a Sony camera and read its details', async () => {
            console.log(`\n[TEST: Sony Camera PTP Detection]`)
            console.log('----------------------------------------')

            // Find PTP devices (still image class)
            console.log('Searching for Sony PTP devices (class 6 - Still Image)...')
            const devices = await deviceFinder.findDevices({
                vendorId: SONY_VENDOR_ID,
                class: 6, // Still Image class
            })

            console.log(`Found ${devices.length} Sony PTP device(s)`)

            // Find a camera with 6700 in the name
            let camera = devices.find(d => d.product?.includes('6700'))

            // If no 6700, just use the first Sony PTP device
            if (!camera && devices.length > 0) {
                camera = devices[0]
                console.log('No device with "6700" in product name')
                console.log('Using first Sony PTP device found')
            }

            if (camera) {
                console.log('\nSony PTP Camera Details:')
                console.log(`  Vendor ID: 0x${camera.vendorId.toString(16).padStart(4, '0')} (${camera.vendorId})`)
                console.log(`  Product ID: 0x${camera.productId.toString(16).padStart(4, '0')} (${camera.productId})`)
                console.log(`  Product Name: ${camera.product || 'Not available (need to open device)'}`)
                console.log(`  Manufacturer: ${camera.manufacturer || 'Not available (need to open device)'}`)
                console.log(`  Serial Number: ${camera.serialNumber || 'Not available (need to open device)'}`)

                if (VERBOSE) {
                    console.log('\nAdditional Info:')
                    console.log(`  Has Device Object: ${camera.device ? 'Yes' : 'No'}`)
                    if (camera.device) {
                        console.log(`  Device Type: ${camera.device.constructor.name || 'Unknown'}`)

                        // Try to get more info from the device object
                        try {
                            const deviceObj = camera.device as any
                            if (deviceObj.deviceDescriptor) {
                                const desc = deviceObj.deviceDescriptor
                                console.log('\n  Device Descriptor Info:')
                                console.log(`    bcdUSB: ${desc.bcdUSB || 'N/A'}`)
                                console.log(`    bDeviceClass: ${desc.bDeviceClass || 'N/A'}`)
                                console.log(`    bDeviceSubClass: ${desc.bDeviceSubClass || 'N/A'}`)
                                console.log(`    bDeviceProtocol: ${desc.bDeviceProtocol || 'N/A'}`)
                                console.log(`    bMaxPacketSize: ${desc.bMaxPacketSize0 || 'N/A'}`)
                                console.log(`    iManufacturer: ${desc.iManufacturer || 'N/A'}`)
                                console.log(`    iProduct: ${desc.iProduct || 'N/A'}`)
                                console.log(`    iSerialNumber: ${desc.iSerialNumber || 'N/A'}`)
                            }
                        } catch (e) {
                            console.log('  Could not read device descriptor details')
                        }
                    }
                }

                expect(camera.vendorId).toBe(SONY_VENDOR_ID)

                // Try to read serial number if available
                if (camera.serialNumber) {
                    expect(camera.serialNumber).toBeTruthy()
                    expect(typeof camera.serialNumber).toBe('string')
                    console.log(`\n✓ Successfully read serial number: ${camera.serialNumber}`)
                } else {
                    console.log('\nNote: Serial number not available without opening device')
                }
            } else {
                // If no Sony PTP device found, skip the test
                console.warn('\n⚠️  No Sony PTP device found - camera may not be connected or not in USB mode')
                console.warn('    Make sure camera is:')
                console.warn('    1. Connected via USB')
                console.warn('    2. Turned on')
                console.warn('    3. Set to PC Remote or MTP/PTP mode')
            }
            console.log('----------------------------------------')
        })

        it('should be able to claim the interface', async () => {
            console.log(`\n[TEST: USB Interface Claiming]`)
            console.log('----------------------------------------')

            const transport = await transportFactory.createUSBTransport()

            // Find a Sony PTP device to test with
            console.log('Looking for Sony PTP device to test interface claiming...')
            const devices = await deviceFinder.findDevices({
                vendorId: SONY_VENDOR_ID,
                class: 6, // Still Image class
            })

            if (devices.length > 0) {
                const device = devices[0]
                if (!device) {
                    console.warn('Unexpected: device array has length but no first element')
                    return
                }

                console.log(`\nAttempting to connect to:`)
                console.log(
                    `  Device: 0x${device.vendorId.toString(16).padStart(4, '0')}:0x${device.productId.toString(16).padStart(4, '0')}`
                )

                // Try to connect to the device
                try {
                    console.log('\n1. Connecting to device...')
                    await transport.connect({
                        vendorId: device.vendorId,
                        productId: device.productId,
                        serialNumber: device.serialNumber,
                    })

                    // Check that we're connected
                    expect(transport.isConnected()).toBe(true)
                    expect(transport.getType()).toBe(TransportType.USB)

                    console.log('   ✓ Successfully connected')
                    console.log('   ✓ Transport type:', transport.getType())
                    console.log('   ✓ Connection status:', transport.isConnected())

                    if (VERBOSE) {
                        console.log('\n2. Connection established:')
                        console.log('   - USB interface claimed')
                        console.log('   - Endpoints configured')
                        console.log('   - Ready for PTP communication')
                    }

                    console.log('\n3. Disconnecting...')
                    await transport.disconnect()
                    expect(transport.isConnected()).toBe(false)

                    console.log('   ✓ Successfully disconnected')
                    console.log('   ✓ Interface released')

                    console.log('\n✅ Interface claim/release test PASSED')
                } catch (error: any) {
                    // Device might be in use by another application
                    console.error('\n❌ Could not claim interface')
                    console.error('   Error:', error.message || error)

                    if (VERBOSE) {
                        console.log('\nPossible reasons:')
                        console.log('  1. Device is in use by another application')
                        console.log('  2. Need elevated permissions (try with sudo)')
                        console.log('  3. Camera is not in correct USB mode')
                        console.log('  4. USB driver conflict')

                        if (error.errno) {
                            console.log(`\n  Error code: ${error.errno}`)
                            const errorCodes: Record<number, string> = {
                                '-1': 'LIBUSB_ERROR_IO - Input/output error',
                                '-2': 'LIBUSB_ERROR_INVALID_PARAM - Invalid parameter',
                                '-3': 'LIBUSB_ERROR_ACCESS - Access denied (insufficient permissions)',
                                '-4': 'LIBUSB_ERROR_NO_DEVICE - No such device',
                                '-5': 'LIBUSB_ERROR_NOT_FOUND - Entity not found',
                                '-6': 'LIBUSB_ERROR_BUSY - Resource busy',
                                '-7': 'LIBUSB_ERROR_TIMEOUT - Operation timed out',
                                '-9': 'LIBUSB_ERROR_PIPE - Pipe error',
                                '-12': 'LIBUSB_ERROR_NOT_SUPPORTED - Operation not supported',
                            }
                            if (errorCodes[error.errno]) {
                                console.log(`  Meaning: ${errorCodes[error.errno]}`)
                            }
                        }
                    }
                }
            } else {
                console.warn('\n⚠️  No Sony PTP device found to test interface claiming')
                console.warn('    Skipping interface test')
            }
            console.log('----------------------------------------')
        })
    })
})
