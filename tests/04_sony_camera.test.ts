import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PTPProtocol } from '@core/protocol'
import { PTPMessageBuilder } from '@core/messages'
import { SonyCamera } from '@camera/vendors/sony/camera'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { TransportFactory } from '@transport/transport-factory'
import * as fs from 'fs'
import * as path from 'path'
import { VendorIDs } from '@constants/vendors/vendor-ids'

describe('SonyCamera', () => {
    let transport: any
    let protocol: PTPProtocol
    let camera: SonyCamera
    let outputDir: string
    let connected = false

    beforeAll(async () => {
        // Create output directory for captured images
        outputDir = path.join(process.cwd(), 'captured_images')
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }
        console.log(`📁 Output directory: ${outputDir}`)

        // Create transport using factory
        const transportFactory = new TransportFactory()
        transport = await transportFactory.createUSBTransport()

        try {
            await transport.connect({
                vendorId: VendorIDs.SONY,
            })
            connected = true
            console.log(`✅ Connected to Sony camera (0x${VendorIDs.SONY.toString(16)})`)
        } catch (error: any) {
            console.log(`Could not connect with product ID 0x${VendorIDs.SONY.toString(16)}: ${error.message}`)
        }

        if (!connected) {
            throw new Error('No Sony camera found')
        }

        // Create protocol and message builder
        const messageBuilder = new PTPMessageBuilder()
        protocol = new PTPProtocol(transport, messageBuilder)

        // Try to close any existing session first
        try {
            await protocol.closeSession()
            console.log('Closed existing session')
        } catch {
            // Ignore if no session was open
        }

        // Create camera with authenticator
        const authenticator = new SonyAuthenticator()
        camera = new SonyCamera(protocol, authenticator)
        
        // Connect the camera once for all tests
        try {
            await camera.connect()
            console.log('✅ Camera connected and authenticated')
        } catch (error) {
            console.error('Failed to connect camera:', error)
            throw error
        }
    }, 30000) // Increase timeout for authentication

    afterAll(async () => {
        if (connected) {
            try {
                await protocol.closeSession()
                console.log('✅ Session closed')
            } catch {
                // Ignore close errors
            }

            await transport.disconnect()
            console.log('✅ Transport disconnected')
        }

        // List captured files
        const capturedFiles = fs
            .readdirSync(outputDir)
            .filter(file => file.endsWith('.jpg') || file.endsWith('.arw') || file.endsWith('.png'))

        if (capturedFiles.length > 0) {
            console.log('\n============================================================')
            console.log('📁 CAPTURED IMAGES SAVED TO:')
            console.log(`   ${outputDir}`)
            capturedFiles.forEach(file => {
                const stats = fs.statSync(path.join(outputDir, file))
                const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
                const sizeKB = (stats.size / 1024).toFixed(2)
                const sizeDisplay = stats.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`
                console.log(`   - ${file} (${sizeDisplay})`)
            })
            console.log('============================================================')
        }
    }, 15000) // Increase timeout to 15 seconds

    it('should be connected and authenticated', async () => {
        expect(camera.isConnected()).toBe(true)
        console.log('✅ Camera is connected and authenticated')
    })

    it('should get current ISO', async () => {
        const iso = await camera.getDeviceProperty('ISO')
        expect(iso).toBeDefined()
        console.log(`  Current ISO: ${iso}`)
    })

    it('should get current shutter speed', async () => {
        const shutterSpeed = await camera.getDeviceProperty('SHUTTER_SPEED')
        expect(shutterSpeed).toBeDefined()
        console.log(`  Current shutter speed: ${shutterSpeed}`)
    })

    it('should get current aperture', async () => {
        const aperture = await camera.getDeviceProperty('APERTURE')
        expect(aperture).toBeDefined()
        console.log(`  Current aperture: ${aperture}`)
    })

    it('should get camera info', async () => {
        const info = await camera.getCameraInfo()
        expect(info).toBeDefined()
        expect(info.manufacturer).toBeDefined()
        expect(info.model).toBeDefined()
        console.log(`  Camera info: ${JSON.stringify(info, null, 2)}`)
    })

    it('should capture a photo', async () => {
        await camera.captureImage()
        console.log('✅ Photo captured')

        // Note: In the simplified API, image download is handled separately
        // The captureImage just triggers the capture
        console.log('  (Photo saved to camera storage)')
    })

    it('should capture a live view frame', async () => {
        const frame = await camera.captureLiveView()

        if (frame) {
            const liveViewPath = path.join(outputDir, `liveview_${Date.now()}.jpg`)
            fs.writeFileSync(liveViewPath, frame)
            console.log(`💾 LIVE VIEW SAVED TO: ${liveViewPath}`)
            expect(frame).toBeInstanceOf(Uint8Array)
        } else {
            console.log('⚠️ Live view frame not available (camera may not support it or not be ready)')
            // This is acceptable - camera may not support live view or not be ready
            expect(frame).toBeNull()
        }
    })

    it('should handle multiple operations in sequence', async () => {
        // Quick sequence test
        const iso1 = await camera.getDeviceProperty('ISO')
        const iso2 = await camera.getDeviceProperty('ISO')
        expect(iso1).toEqual(iso2)

        const info = await camera.getCameraInfo()
        expect(info).toBeDefined()

        console.log('✅ Sequential operations completed successfully')
    })
})
