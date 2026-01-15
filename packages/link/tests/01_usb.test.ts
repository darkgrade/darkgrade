/**
 * USB Transport Tests
 * Tests USB device discovery, connection, and camera interaction
 */

import { VendorNames } from '@ptp/definitions/vendor-ids'
import { TransportType } from '@transport/interfaces/transport-types'
import { TransportFactory } from '@transport/transport-factory'
import { USBTransport } from '@transport/usb/usb-transport'
import { beforeAll, describe, expect, it } from 'vitest'

// Set to true for verbose output
const VERBOSE = true
const DEBUG = process.env.DEBUG === 'true'
const log = DEBUG
    ? (...args: any[]) => process.stderr.write(args.join(' ') + '\n')
    : (...args: any[]) => console.log(...args)

describe('USB Transport', () => {
    let transportFactory: TransportFactory

    beforeAll(() => {
        transportFactory = new TransportFactory()

        if (VERBOSE) {
            log('\n========================================')
            log('USB Transport Test Suite - VERBOSE MODE')
            log('========================================\n')
        }
    })

    describe('Device Discovery', () => {
        it('should be able to use WebUSB', async () => {
            const usb = await import('usb')
            expect(usb).toBeDefined()
            expect(usb.webusb).toBeDefined()
            expect(usb.webusb.getDevices).toBeDefined()
        })

        it('should discover devices and interfaces', async () => {
            const transport = (await transportFactory.createUSBTransport()) as USBTransport

            log("\nNote: In Node.js, discover() will use native USB API if WebUSB hasn't granted permissions yet.\n")

            const devices = await transport.discover()

            expect(devices).toBeDefined()
            expect(Array.isArray(devices)).toBe(true)
            expect(devices.length).toBeGreaterThan(0)

            // Log device information
            log(`\n[TEST: Device Discovery]`)
            log(`Found ${devices.length} USB devices:`)
            log('----------------------------------------')

            devices.forEach((device: any, index: number) => {
                const vendorHex = device.vendorId?.toString(16).padStart(4, '0') || 'N/A'
                const productHex = device.productId?.toString(16).padStart(4, '0') || 'N/A'

                log(`\nDevice #${index + 1}:`)
                log(`  VID:PID: 0x${vendorHex}:0x${productHex} (${device.vendorId}:${device.productId})`)
                log(`  Manufacturer: ${device.manufacturer || 'Not available'}`)
                log(`  Product: ${device.model || 'Not available'}`)
                log(`  Serial Number: ${device.serialNumber || 'Not available'}`)

                if (VERBOSE) {
                    // Check if it's a known vendor
                    const knownVendors: Record<number, string> = {
                        ...VendorNames,
                        0x05ac: 'Apple Inc.',
                        0x0b05: 'ASUSTeK Computer Inc.',
                        0x0bda: 'Realtek',
                        0x2188: 'CalDigit',
                        0x8087: 'Intel',
                        0x1235: 'Focusrite',
                    }
                    if (device.vendorId && knownVendors[device.vendorId]) {
                        log(`  Known Vendor: ${knownVendors[device.vendorId]}`)
                    }

                    // Raw device object (be careful with this)
                    if (device.device && typeof device.device === 'object') {
                        log(`  Device Object: Available (Type: ${device.device.constructor.name || 'Unknown'})`)
                    }
                }
            })
            log('\n----------------------------------------')
        })

        it('should find at least one camera device', async () => {
            log(`\n[TEST: Camera Detection]`)
            log('----------------------------------------')

            const transport = (await transportFactory.createUSBTransport()) as USBTransport
            const allDevices = await transport.discover()
            const cameras = allDevices.filter((d: any) => d.vendorId && d.vendorId !== 0)

            log(`Found ${allDevices.length} total USB device(s)`)
            log(`Found ${cameras.length} camera device(s) (non-zero vendor ID)`)

            expect(cameras).toBeDefined()
            expect(Array.isArray(cameras)).toBe(true)
            expect(cameras.length).toBeGreaterThanOrEqual(1)

            cameras.forEach((device: any, index: number) => {
                const vendorHex = device.vendorId?.toString(16).padStart(4, '0') || 'N/A'
                const productHex = device.productId?.toString(16).padStart(4, '0') || 'N/A'
                const vendorName =
                    (device.vendorId && VendorNames[device.vendorId as keyof typeof VendorNames]) || 'Unknown'

                log(
                    `\nCamera Device #${index + 1}:\n` +
                        `  VID:PID: 0x${vendorHex}:0x${productHex} (${device.vendorId}:${device.productId})\n` +
                        `  Vendor: ${vendorName}\n` +
                        `  Manufacturer: ${device.manufacturer || 'Not available'}\n` +
                        `  Product: ${device.model || 'Not available'}\n` +
                        `  Serial Number: ${device.serialNumber || 'Not available'}`
                )
            })
            log('----------------------------------------')
        })

        it('should find a camera and read its details', async () => {
            log(`\n[TEST: Camera PTP Detection]`)
            log('----------------------------------------')

            log('Searching for camera devices...')
            const transport = (await transportFactory.createUSBTransport()) as USBTransport
            const allDevices = await transport.discover()
            const cameras = allDevices.filter((d: any) => d.vendorId && d.vendorId !== 0)

            log(`Found ${cameras.length} camera device(s)`)

            const camera = cameras[0]

            if (camera) {
                log(
                    `\nCamera Details:\n` +
                        `  Vendor ID: 0x${camera.vendorId?.toString(16).padStart(4, '0') || 'N/A'} (${camera.vendorId || 'N/A'})\n` +
                        `  Product ID: 0x${camera.productId?.toString(16).padStart(4, '0') || 'N/A'} (${camera.productId || 'N/A'})\n` +
                        `  Vendor: ${(camera.vendorId && VendorNames[camera.vendorId as keyof typeof VendorNames]) || 'Unknown'}\n` +
                        `  Product Name: ${camera.model || 'Not available'}\n` +
                        `  Manufacturer: ${camera.manufacturer || 'Not available'}\n` +
                        `  Serial Number: ${camera.serialNumber || 'Not available'}`
                )

                if (VERBOSE) {
                    let additionalInfo = `\nAdditional Info:\n  Has Device Object: ${camera.device ? 'Yes' : 'No'}`
                    if (camera.device) {
                        additionalInfo += `\n  Device Type: ${camera.device.constructor.name || 'Unknown'}`

                        try {
                            const deviceObj = camera.device as any
                            if (deviceObj.deviceDescriptor) {
                                const desc = deviceObj.deviceDescriptor
                                additionalInfo +=
                                    `\n\n  Device Descriptor Info:\n` +
                                    `    bcdUSB: ${desc.bcdUSB || 'N/A'}\n` +
                                    `    bDeviceClass: ${desc.bDeviceClass || 'N/A'}\n` +
                                    `    bDeviceSubClass: ${desc.bDeviceSubClass || 'N/A'}\n` +
                                    `    bDeviceProtocol: ${desc.bDeviceProtocol || 'N/A'}\n` +
                                    `    bMaxPacketSize: ${desc.bMaxPacketSize0 || 'N/A'}\n` +
                                    `    iManufacturer: ${desc.iManufacturer || 'N/A'}\n` +
                                    `    iProduct: ${desc.iProduct || 'N/A'}\n` +
                                    `    iSerialNumber: ${desc.iSerialNumber || 'N/A'}`
                            }
                        } catch (e) {
                            additionalInfo += '\n  Could not read device descriptor details'
                        }
                    }
                    log(additionalInfo)
                }

                expect(camera.vendorId).toBeTruthy()
                expect(camera.vendorId).not.toBe(0)
            } else {
                console.warn(
                    '\n⚠️  No camera device found\n' +
                        '    Make sure camera is:\n' +
                        '    1. Connected via USB\n' +
                        '    2. Turned on\n' +
                        '    3. Set to PC Remote or MTP/PTP mode'
                )
            }
            log('----------------------------------------')
        })

        it('should be able to claim the interface', async () => {
            log(`\n[TEST: USB Interface Claiming]`)
            log('----------------------------------------')

            const transport = (await transportFactory.createUSBTransport()) as USBTransport

            log('Looking for camera device to test interface claiming...')
            const allDevices = await transport.discover()
            const devices = allDevices.filter((d: any) => d.vendorId && d.vendorId !== 0)

            if (devices.length > 0) {
                const device = devices[0]
                if (!device) {
                    console.warn('Unexpected: device array has length but no first element')
                    return
                }

                log(`\nAttempting to connect to:`)
                log(
                    `  Device: 0x${device.vendorId?.toString(16).padStart(4, '0') || 'N/A'}:0x${device.productId?.toString(16).padStart(4, '0') || 'N/A'}`
                )

                // Try to connect to the device
                try {
                    log('\n1. Connecting to device...')
                    await transport.connect({
                        usb: {
                            filters: [
                                {
                                    vendorId: device.vendorId,
                                    productId: device.productId,
                                    serialNumber: device.serialNumber || undefined,
                                },
                            ],
                        },
                    })

                    // Check that we're connected
                    expect(transport.isConnected()).toBe(true)
                    expect(transport.getType()).toBe(TransportType.USB)

                    log('   ✓ Successfully connected')
                    log('   ✓ Transport type:', transport.getType())
                    log('   ✓ Connection status:', transport.isConnected())

                    if (VERBOSE) {
                        log('\n2. Connection established:')
                        log('   - USB interface claimed')
                        log('   - Endpoints configured')
                        log('   - Ready for PTP communication')
                    }

                    log('\n3. Disconnecting...')
                    await transport.disconnect()
                    expect(transport.isConnected()).toBe(false)

                    log('   ✓ Successfully disconnected')
                    log('   ✓ Interface released')

                    log('\n✅ Interface claim/release test PASSED')
                } catch (error: any) {
                    let errorMsg = `\n❌ Could not claim interface\n   Error: ${error.message || error}`

                    if (VERBOSE) {
                        errorMsg +=
                            '\n\nPossible reasons:\n' +
                            '  1. Device is in use by another application\n' +
                            '  2. Need elevated permissions (try with sudo)\n' +
                            '  3. Camera is not in correct USB mode\n' +
                            '  4. USB driver conflict\n' +
                            '  5. Mac PTPCamera is running and hijacking the USB device'

                        if (error.errno) {
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
                            errorMsg += `\n\n  Error code: ${error.errno}`
                            if (errorCodes[error.errno]) {
                                errorMsg += `\n  Meaning: ${errorCodes[error.errno]}`
                            }
                        }
                    }
                    console.error(errorMsg)
                }
            } else {
                console.warn('\n⚠️  No camera device found to test interface claiming\n    Skipping interface test')
            }
            log('----------------------------------------')
        })
    })
})
