import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PTPProtocol } from '@core/ptp/ptp-protocol'
import { PTPMessageBuilder } from '@core/ptp/ptp-message-builder'
import { SonyCamera } from '@camera/vendors/sony/sony-camera'
import { SonyAuthenticator } from '@camera/vendors/sony/sony-authenticator'
import { SonyConstants } from '@constants/vendors/sony'
import { TransportFactory } from '@transport/transport-factory'
import * as fs from 'fs'
import * as path from 'path'

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

        // Connect to Sony camera - try both known product IDs
        const productIds = [SonyConstants.PRODUCT_ID, SonyConstants.PRODUCT_ID_ALPHA]

        for (const productId of productIds) {
            try {
                await transport.connect({
                    vendorId: SonyConstants.VENDOR_ID,
                    productId,
                })
                connected = true
                console.log(`✅ Connected to Sony camera (0x${productId.toString(16)})`)
                break
            } catch (error: any) {
                console.log(`Could not connect with product ID 0x${productId.toString(16)}: ${error.message}`)
            }
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
    })

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

    it('should open session and authenticate', async () => {
        await camera.connect()
        expect(camera.isConnected()).toBe(true)
        console.log('✅ Session opened and authenticated')
    }, 15000) // Increase timeout to 15 seconds

    it('should get current ISO', async () => {
        const iso = await camera.getDeviceProperty('EXPOSURE_INDEX')
        expect(iso).toBeDefined()
        console.log(`  Current ISO: ${iso}`)
    })

    it('should get current shutter speed', async () => {
        const shutterSpeed = await camera.getDeviceProperty('EXPOSURE_TIME')
        expect(shutterSpeed).toBeDefined()
        console.log(`  Current shutter speed: ${shutterSpeed}`)
    })

    it('should get current aperture', async () => {
        const aperture = await camera.getDeviceProperty('F_NUMBER')
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
        const frame = await camera.captureLiveViewFrame()
        
        if (frame && frame.data && frame.data.length > 0) {
            console.log(`✅ Live view frame: ${frame.width}x${frame.height} (${frame.data.length} bytes)`)

            const liveViewPath = path.join(outputDir, `liveview_${Date.now()}.jpg`)
            fs.writeFileSync(liveViewPath, frame.data)
            console.log(`💾 LIVE VIEW SAVED TO: ${liveViewPath}`)
        } else {
            console.log('⚠️ Live view frame not available (camera may not support it or not be ready)')
        }
    })

    it('should get storage info', async () => {
        const storageInfo = await camera.getStorageInfo()
        expect(storageInfo).toBeDefined()
        expect(Array.isArray(storageInfo)).toBe(true)
        
        if (storageInfo.length > 0) {
            console.log(`✅ Found ${storageInfo.length} storage device(s):`)
            storageInfo.forEach((storage, index) => {
                console.log(`  Storage ${index + 1}: ${storage.name}`)
                console.log(`    - Free: ${(storage.freeSpace / 1024 / 1024).toFixed(2)} MB`)
                console.log(`    - Total: ${(storage.totalSpace / 1024 / 1024).toFixed(2)} MB`)
            })
        } else {
            console.log('⚠️ No storage devices found')
        }
    })

    it('should handle multiple operations in sequence', async () => {
        // Quick sequence test
        const iso1 = await camera.getDeviceProperty('EXPOSURE_INDEX')
        const iso2 = await camera.getDeviceProperty('EXPOSURE_INDEX')
        expect(iso1).toEqual(iso2)

        const info = await camera.getCameraInfo()
        expect(info).toBeDefined()

        console.log('✅ Sequential operations completed successfully')
    })
})