import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import * as SonyProps from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { USBTransport } from '@transport/usb/usb-transport'
import * as fs from 'fs'
import * as path from 'path'
import { WebUSB } from 'usb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SonyCamera } from '../src/camera/sony-camera'

const sonyConnected = (await new WebUSB({ allowAllDevices: true }).getDevices()).some(
    device => device.vendorId === VendorIDs.SONY
)
const hardwareOperationTimeoutMilliseconds = 15_000
const captureTimeoutMilliseconds = 30_000

describe.skipIf(!sonyConnected)('SonyCamera', () => {
    let transport: any
    let camera: SonyCamera
    let logger: Logger
    let outputDir: string
    let connected = false
    let initialAperture: string | undefined
    let initialIso: string | undefined
    let initialShutterSpeed: string | undefined

    beforeAll(async () => {
        outputDir = path.join(process.cwd(), 'captured_images')
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }
        console.log(`📁 Output directory: ${outputDir}`)

        logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
        transport = new USBTransport(logger)
        camera = new SonyCamera(transport, logger)

        await camera.connect({ usb: { filters: [{ vendorId: VendorIDs.SONY }] } })
        connected = true
        initialAperture = await camera.get(SonyProps.Aperture)
        initialIso = await camera.get(SonyProps.Iso)
        initialShutterSpeed = await camera.get(SonyProps.ShutterSpeed)
        await camera.set(SonyProps.ShutterSpeed, '1/60')
        await camera.set(SonyProps.Iso, 'ISO AUTO')
        await camera.set(SonyProps.Aperture, 'f/5.6')
        console.log('✅ Camera connected and authenticated')
    }, hardwareOperationTimeoutMilliseconds)

    afterAll(async () => {
        if (connected && camera) {
            const restore = async (
                label: string,
                value: string | undefined,
                action: (value: string) => Promise<void>
            ) => {
                if (!value) return
                try {
                    await action(value)
                } catch (error: any) {
                    console.log(`Note: could not restore ${label}:`, error.message)
                }
            }

            await restore('shutter speed', initialShutterSpeed, value => camera.set(SonyProps.ShutterSpeed, value))
            await restore('ISO', initialIso, value => camera.set(SonyProps.Iso, value))
            await restore('aperture', initialAperture, value => camera.set(SonyProps.Aperture, value))

            try {
                await Promise.race([
                    camera.disconnect(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Disconnect timeout')), hardwareOperationTimeoutMilliseconds)
                    ),
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
    }, hardwareOperationTimeoutMilliseconds)

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

    it(
        'should capture a photo',
        async () => {
            const result = await camera.captureImage()

            expect(result).toBeDefined()
            expect(result?.data).toBeInstanceOf(Uint8Array)
            expect(result?.info?.filename).toBeDefined()

            const photoPath = path.join(outputDir, result!.info!.filename)
            fs.writeFileSync(photoPath, result!.data!)
            console.log(`💾 PHOTO SAVED TO: ${photoPath}`)
        },
        captureTimeoutMilliseconds
    )

    it(
        'should capture a live view image',
        async () => {
            const result = await camera.captureLiveView()

            expect(result).toBeDefined()
            expect(result?.data).toBeInstanceOf(Uint8Array)

            const liveViewPath = path.join(outputDir, `liveview_${Date.now()}.jpg`)
            fs.writeFileSync(liveViewPath, result!.data!)
            console.log(`💾 LIVE VIEW SAVED TO: ${liveViewPath}`)
        },
        hardwareOperationTimeoutMilliseconds
    )

    it(
        'should stream live view',
        async () => {
            const result = await camera.captureLiveView()

            expect(result?.data).toBeInstanceOf(Uint8Array)
            expect(result?.data?.length).toBeGreaterThan(0)

            const streamPath = path.join(outputDir, `stream_${Date.now()}.jpg`)
            fs.writeFileSync(streamPath, result!.data!)
            console.log(`💾 STREAM SAVED TO: ${streamPath}`)
        },
        hardwareOperationTimeoutMilliseconds
    )

    it(
        'should handle multiple operations in sequence',
        async () => {
            const iso1 = await camera.get(SonyProps.Iso)
            const iso2 = await camera.get(SonyProps.Iso)
            expect(iso1).toEqual(iso2)

            console.log('✅ Sequential operations completed successfully')
        },
        hardwareOperationTimeoutMilliseconds
    )
})
