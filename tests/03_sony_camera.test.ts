import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import * as SonyProps from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { TransportFactory } from '@transport/transport-factory'
import * as fs from 'fs'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SonyCamera } from '../src/camera/sony-camera'

describe('SonyCamera', () => {
    let transport: any
    let camera: SonyCamera
    let logger: Logger
    let outputDir: string
    let connected = false

    beforeAll(async () => {
        outputDir = path.join(process.cwd(), 'captured_images')
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }
        console.log(`📁 Output directory: ${outputDir}`)

        const transportFactory = new TransportFactory()
        transport = await transportFactory.createUSBTransport()

        logger = new Logger()
        camera = new SonyCamera(transport, logger)

        await camera.connect({ usb: { filters: [{ vendorId: VendorIDs.SONY }] } })
        connected = true
        console.log('✅ Camera connected and authenticated')
    }, 2000)

    afterAll(async () => {
        if (connected && camera) {
            try {
                await Promise.race([
                    camera.disconnect(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect timeout')), 2000)),
                ])
                console.log('✅ Camera disconnected')
            } catch (e: any) {
                console.log('Note: disconnect error:', e.message)
            }
        }

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
    }, 2000)

    it('should be connected and authenticated', async () => {
        expect(camera.sessionId).toBeTruthy()
        console.log('✅ Camera is connected and authenticated')
    })

    it('should get current ISO', async () => {
        const iso = await camera.get(SonyProps.Iso)
        expect(iso).toBeDefined()
        console.log(`  Current ISO: ${iso}`)
    })

    it('should get current shutter speed', async () => {
        const shutterSpeed = await camera.get(SonyProps.ShutterSpeed)
        expect(shutterSpeed).toBeDefined()
        console.log(`  Current shutter speed: ${shutterSpeed}`)
    })

    it('should get current aperture', async () => {
        const aperture = await camera.get(SonyProps.Aperture)
        expect(aperture).toBeDefined()
        console.log(`  Current aperture: ${aperture}`)
    })

    it('should capture a photo', async () => {
        const result = await camera.captureImage()

        expect(result).toBeDefined()
        expect(result?.data).toBeInstanceOf(Uint8Array)
        expect(result?.info?.filename).toBeDefined()

        const photoPath = path.join(outputDir, result!.info!.filename)
        fs.writeFileSync(photoPath, result!.data!)
        console.log(`💾 PHOTO SAVED TO: ${photoPath}`)
    }, 2000)

    it('should capture a live view image', async () => {
        const result = await camera.captureLiveView()

        expect(result).toBeDefined()
        expect(result?.data).toBeInstanceOf(Uint8Array)

        const liveViewPath = path.join(outputDir, `liveview_${Date.now()}.jpg`)
        fs.writeFileSync(liveViewPath, result!.data!)
        console.log(`💾 LIVE VIEW SAVED TO: ${liveViewPath}`)
    }, 2000)

    it('should stream live view', async () => {
        const result = await camera.captureLiveView()

        expect(result?.data).toBeInstanceOf(Uint8Array)
        expect(result?.data?.length).toBeGreaterThan(0)

        const streamPath = path.join(outputDir, `stream_${Date.now()}.jpg`)
        fs.writeFileSync(streamPath, result!.data!)
        console.log(`💾 STREAM SAVED TO: ${streamPath}`)
    }, 2000)

    it('should handle multiple operations in sequence', async () => {
        const iso1 = await camera.get(SonyProps.Iso)
        const iso2 = await camera.get(SonyProps.Iso)
        expect(iso1).toEqual(iso2)

        console.log('✅ Sequential operations completed successfully')
    }, 2000)
})
