/**
 * PTP Protocol Tests
 * Tests PTP protocol operations with real camera
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { TransportFactory } from '@transport/transport-factory'
import { USBTransport } from '@transport/usb/usb-transport'
import { USBDeviceFinder } from '@transport/usb/usb-device-finder'
import { PTPProtocol } from '@core/ptp-protocol'
import { PTPMessageBuilder } from '@core/ptp-message-builder'
import { PTPOperations } from '@constants/ptp/operations'
import { PTPResponses } from '@constants/ptp/responses'

// These will be populated by device discovery
let discoveredVendorId = 0
let discoveredProductId = 0

describe('PTP Protocol', () => {
    let transport: USBTransport
    let protocol: PTPProtocol
    let deviceFinder: USBDeviceFinder
    let deviceFound = false

    beforeAll(async () => {
        console.log('\n========================================')
        console.log('PTP Protocol Test Suite')
        console.log('========================================\n')

        // Create device finder
        deviceFinder = new USBDeviceFinder()

        // Auto-discover PTP devices
        console.log('Auto-discovering PTP devices...')
        const devices = await deviceFinder.findDevices({
            vendorId: 0, // 0 means auto-discover
            productId: 0,
            class: 6, // Still Image class
        })

        if (devices.length === 0) {
            console.warn('⚠️ No PTP device found - tests will be skipped')
            console.warn('   Make sure camera is:')
            console.warn('   1. Connected via USB')
            console.warn('   2. Turned on')
            console.warn('   3. Set to PC Remote or MTP/PTP mode')
            return
        }

        deviceFound = true
        const device = devices[0]
        if (device) {
            discoveredVendorId = device.vendorId
            discoveredProductId = device.productId
            console.log(
                `Auto-discovered device: 0x${discoveredVendorId.toString(16).padStart(4, '0')}:0x${discoveredProductId.toString(16).padStart(4, '0')}`
            )
        }

        // Create transport
        const transportFactory = new TransportFactory()
        transport = await transportFactory.createUSBTransport() as unknown as USBTransport

        // Create message builder and protocol
        const messageBuilder = new PTPMessageBuilder()
        protocol = new PTPProtocol(transport, messageBuilder)
    })

    afterAll(async () => {
        if (protocol && protocol.isSessionOpen()) {
            console.log('\nClosing session...')
            await protocol.closeSession()
        }
        if (transport && transport.isConnected()) {
            console.log('Disconnecting transport...')
            await transport.disconnect()
        }
    })

    describe('Transport Connection', () => {
        it('should connect to the camera via USB', async () => {
            if (!deviceFound) {
                console.log('Skipping: No device found')
                return
            }

            console.log('\n[TEST: USB Connection]')
            console.log('----------------------------------------')

            // Use the already discovered device IDs
            const devices = await deviceFinder.findDevices({
                vendorId: discoveredVendorId,
                productId: discoveredProductId,
                class: 6,
            })

            expect(devices.length).toBeGreaterThan(0)
            const device = devices[0]

            if (!device) {
                console.log('No device found in array')
                return
            }

            console.log('Connecting to device...')
            await transport.connect({
                vendorId: device.vendorId,
                productId: device.productId,
                serialNumber: device.serialNumber,
            })

            expect(transport.isConnected()).toBe(true)
            console.log('✓ Successfully connected')
            console.log('✓ USB interface claimed')
            console.log('✓ Endpoints configured')
            console.log('----------------------------------------')
        })
    })

    describe('PTP Session', () => {
        it('should open a PTP session', async () => {
            if (!deviceFound || !transport.isConnected()) {
                console.log('Skipping: No device or not connected')
                return
            }

            console.log('\n[TEST: Open Session]')
            console.log('----------------------------------------')

            const sessionId = 1
            console.log(`Opening session with ID: ${sessionId}`)

            await protocol.openSession(sessionId)

            expect(protocol.isSessionOpen()).toBe(true)
            expect(protocol.getSessionId()).toBe(sessionId)

            console.log('✓ Session opened successfully')
            console.log(`✓ Session ID: ${protocol.getSessionId()}`)
            console.log('✓ Protocol state: OPEN')
            console.log('----------------------------------------')
        })

        it('should get device info', async () => {
            if (!deviceFound || !transport.isConnected()) {
                console.log('Skipping: No device or not connected')
                return
            }

            console.log('\n[TEST: Get Device Info]')
            console.log('----------------------------------------')

            console.log('Requesting device info...')
            const response = await protocol.getDeviceInfo()

            expect(response.code).toBe(PTPResponses.OK.code)
            expect(response.data).toBeDefined()
            expect(response.data?.byteLength).toBeGreaterThan(0)

            console.log('✓ Device info received')
            console.log(`✓ Response code: 0x${response.code.toString(16).padStart(4, '0')}`)
            console.log(`✓ Data size: ${response.data?.byteLength} bytes`)

            // Try to parse some basic info from the data
            if (response.data) {
                const view = new DataView(response.data.buffer, response.data.byteOffset, response.data.byteLength)

                // PTP standard version (first 2 bytes)
                const standardVersion = view.getUint16(0, true)
                console.log(`✓ PTP Version: ${standardVersion / 100}`)

                // Vendor extension ID (next 4 bytes)
                const vendorExtId = view.getUint32(2, true)
                console.log(`✓ Vendor Extension ID: 0x${vendorExtId.toString(16).padStart(8, '0')}`)
            }

            console.log('----------------------------------------')
        })

        it('should send a simple command', async () => {
            if (!deviceFound || !protocol.isSessionOpen()) {
                console.log('Skipping: No device or session not open')
                return
            }

            console.log('\n[TEST: Send Command]')
            console.log('----------------------------------------')

            console.log('Getting storage IDs...')
            const response = await protocol.sendCommandReceiveData(PTPOperations.GET_STORAGE_IDS.code)

            // Accept OK or STORE_NOT_AVAILABLE (camera might not have storage)
            expect([PTPResponses.OK.code, PTPResponses.STORE_NOT_AVAILABLE.code]).toContain(response.code)
            console.log('✓ Command sent successfully')
            console.log(`✓ Response code: 0x${response.code.toString(16).padStart(4, '0')}`)

            if (response.data && response.data.byteLength >= 4) {
                const view = new DataView(response.data.buffer, response.data.byteOffset, response.data.byteLength)
                const count = view.getUint32(0, true)
                console.log(`✓ Storage count: ${count}`)

                // Read storage IDs
                for (let index = 0; index < Math.min(count, 5); index++) {
                    const storageId = view.getUint32(4 + index * 4, true)
                    console.log(`  - Storage ID ${index + 1}: 0x${storageId.toString(16).padStart(8, '0')}`)
                }
            }

            console.log('----------------------------------------')
        })

        it('should handle multiple operations in sequence', async () => {
            if (!deviceFound || !protocol.isSessionOpen()) {
                console.log('Skipping: No device or session not open')
                return
            }

            console.log('\n[TEST: Sequential Operations]')
            console.log('----------------------------------------')

            // Test a sequence of operations
            const operations = [
                { name: 'Get Storage IDs', code: PTPOperations.GET_STORAGE_IDS.code },
                { name: 'Get Device Info', code: PTPOperations.GET_DEVICE_INFO.code },
            ]

            for (const op of operations) {
                console.log(`Executing: ${op.name}...`)
                const response = await protocol.sendCommandReceiveData(op.code)
                // Accept OK for device info, OK or STORE_NOT_AVAILABLE for storage IDs
                if (op.code === PTPOperations.GET_STORAGE_IDS.code) {
                    expect([PTPResponses.OK.code, PTPResponses.STORE_NOT_AVAILABLE.code]).toContain(response.code)
                } else {
                    expect(response.code).toBe(PTPResponses.OK.code)
                }
                console.log(`✓ ${op.name}: Response 0x${response.code.toString(16).padStart(4, '0')}`)
            }

            console.log('----------------------------------------')
        })

        it('should close the session', async () => {
            if (!deviceFound || !protocol.isSessionOpen()) {
                console.log('Skipping: No device or session not open')
                return
            }

            console.log('\n[TEST: Close Session]')
            console.log('----------------------------------------')

            console.log('Closing session...')
            await protocol.closeSession()

            expect(protocol.isSessionOpen()).toBe(false)
            expect(protocol.getSessionId()).toBeNull()

            console.log('✓ Session closed successfully')
            console.log('✓ Protocol state: CLOSED')
            console.log('----------------------------------------')
        })
    })

    describe('Error Handling', () => {
        it('should handle operation without open session', async () => {
            if (!deviceFound || !transport.isConnected()) {
                console.log('Skipping: No device or not connected')
                return
            }

            console.log('\n[TEST: Error Handling]')
            console.log('----------------------------------------')

            // Make sure session is closed
            if (protocol.isSessionOpen()) {
                await protocol.closeSession()
            }

            console.log('Attempting operation without session...')

            try {
                await protocol.sendCommand(PTPOperations.GET_STORAGE_IDS.code)
                // Should not reach here
                expect(true).toBe(false)
            } catch (error: any) {
                expect(error.name).toBe('PTPError')
                expect(error.code).toBe(PTPResponses.SESSION_NOT_OPEN.code)
                console.log('✓ Correctly threw SESSION_NOT_OPEN error')
            }

            console.log('----------------------------------------')
        })

        it('should handle double session open gracefully', async () => {
            if (!deviceFound || !transport.isConnected()) {
                console.log('Skipping: No device or not connected')
                return
            }

            console.log('\n[TEST: Double Session Open]')
            console.log('----------------------------------------')

            // Open first session
            console.log('Opening first session...')
            await protocol.openSession(1)
            expect(protocol.isSessionOpen()).toBe(true)
            console.log('✓ First session opened')

            // Try to open second session
            console.log('Attempting to open second session...')
            try {
                await protocol.openSession(2)
                // Some cameras might allow this, others won't
                console.log('✓ Camera allowed second session (unexpected but valid)')
            } catch (error: any) {
                expect(error.name).toBe('PTPError')
                console.log('✓ Correctly prevented double session open')
            }

            // Clean up
            await protocol.closeSession()
            console.log('----------------------------------------')
        })
    })
})

// Summary at the end
console.log('\n========================================')
console.log('Test suite complete!')
console.log('========================================')
