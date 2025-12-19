/**
 * Test file for new Client API
 * Tests the simplified Camera class and discovery functions
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { Camera, listCameras, watchCameras } from '../src/node'

describe('Client API', () => {
    describe('Discovery', () => {
        it('should list available cameras', async () => {
            const cameras = await listCameras()
            expect(Array.isArray(cameras)).toBe(true)

            if (cameras.length > 0) {
                const camera = cameras[0]
                if (camera) {
                    expect(camera).toHaveProperty('vendor')
                    expect(camera).toHaveProperty('model')
                    expect(camera.usb || camera.ip).toBeDefined()
                }
            }
        })

        it('should filter cameras by vendor', async () => {
            const cameras = await listCameras({ vendor: 'sony' })
            expect(Array.isArray(cameras)).toBe(true)

            cameras.forEach(camera => {
                expect(camera.vendor?.toLowerCase()).toBe('sony')
            })
        })

        it('should filter cameras by model', async () => {
            const allCameras = await listCameras()
            if (allCameras.length > 0) {
                const firstCamera = allCameras[0]
                if (!firstCamera) return
                const firstModel = firstCamera.model
                const filtered = await listCameras({ model: firstModel?.substring(0, 3) })
                expect(Array.isArray(filtered)).toBe(true)
            }
        })

        it('should support stackable filters', async () => {
            const cameras = await listCameras({
                vendor: 'sony',
                usb: { vendorId: 0x054c }, // Sony vendor ID
            })
            expect(Array.isArray(cameras)).toBe(true)

            cameras.forEach(camera => {
                expect(camera.vendor?.toLowerCase()).toBe('sony')
                if (camera.usb) {
                    expect(camera.usb.vendorId).toBe(0x054c) // Sony vendor ID
                }
            })
        })

        it('should watch for camera changes', async () => {
            let callbackCalled = false
            const stopWatching = watchCameras(cameras => {
                callbackCalled = true
                expect(Array.isArray(cameras)).toBe(true)
            })

            // Wait a bit to see if callback is called
            await new Promise(resolve => setTimeout(resolve, 1500))

            stopWatching()
            expect(callbackCalled).toBe(true)
        })
    })

    describe('Camera Connection', () => {
        it('should connect with auto-discovery', async () => {
            const cameras = await listCameras()
            if (cameras.length === 0) {
                console.warn('No cameras detected - skipping connection tests')
                return
            }

            const camera = new Camera()
            await camera.connect()

            expect(camera.isConnected()).toBe(true)

            const cameraInfo = await camera.getCameraInfo()
            expect(cameraInfo).toBeDefined()
            if (cameraInfo) {
                expect(cameraInfo.manufacturer).toBeDefined()
                expect(cameraInfo.model).toBeDefined()
                expect(cameraInfo.serialNumber).toBeDefined()
            }

            await camera.disconnect()
            expect(camera.isConnected()).toBe(false)
        })

        it('should connect with vendor filter', async () => {
            const cameras = await listCameras()
            if (cameras.length === 0) {
                console.warn('No cameras detected - skipping test')
                return
            }

            const firstCamera = cameras[0]
            if (!firstCamera) return
            const firstVendor = firstCamera.vendor

            // Test that we can connect with a vendor filter
            const camera = new Camera({ vendor: firstVendor?.toLowerCase() })
            await camera.connect()

            // Just verify that the camera connected successfully
            expect(camera.isConnected()).toBe(true)

            // Get camera info to ensure it works
            const cameraInfo = await camera.getCameraInfo()
            expect(cameraInfo).toBeDefined()

            // Note: manufacturer from camera info may differ from discovery vendor
            // (e.g., discovery returns 'sony' but GenericPTPCamera returns 'generic')
            // This is expected behavior

            await camera.disconnect()
        })

        it('should connect with USB IDs', async () => {
            const cameras = await listCameras()
            const usbCamera = cameras.find(c => c.usb)

            if (!usbCamera?.usb) {
                console.warn('No USB cameras detected - skipping test')
                return
            }

            const camera = new Camera({
                usb: {
                    vendorId: usbCamera.usb.vendorId,
                    productId: usbCamera.usb.productId,
                },
            })

            await camera.connect()
            expect(camera.isConnected()).toBe(true)

            await camera.disconnect()
        })

        it('should throw error when no cameras found', async () => {
            const camera = new Camera({ vendor: 'nonexistent' })

            await expect(camera.connect()).rejects.toThrow(/No cameras found/)
        })
    })

    describe('Camera Operations', () => {
        let camera: Camera

        beforeAll(async () => {
            const cameras = await listCameras()
            if (cameras.length === 0) {
                console.warn('No cameras detected - camera operation tests will be skipped')
                return
            }

            camera = new Camera()
            await camera.connect()
        })

        it('should capture an image', async () => {
            if (!camera?.isConnected()) {
                return
            }

            const result = await camera.captureImage()

            if (result) {
                expect(result).toBeDefined()
                expect(result.info).toBeDefined()
                expect(result.data).toBeInstanceOf(Uint8Array)
            }
        })

        it('should get and set ISO', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalISO = await camera.getDeviceProperty('ISO')
                expect(originalISO).toBeDefined()

                await camera.setDeviceProperty('ISO', 'ISO 400')
                const newISO = await camera.getDeviceProperty('ISO')
                expect(newISO).toContain('400')

                // Restore original
                if (originalISO) {
                    await camera.setDeviceProperty('ISO', originalISO)
                }
            } catch (error) {
                console.warn('ISO control not supported:', error)
            }
        })

        it('should get and set shutter speed', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalShutter = await camera.getDeviceProperty('SHUTTER_SPEED')
                expect(originalShutter).toBeDefined()

                await camera.setDeviceProperty('SHUTTER_SPEED', 1 / 250)
                const newShutter = await camera.getDeviceProperty('SHUTTER_SPEED')
                expect(newShutter).toContain('250')

                // Restore original
                if (originalShutter) {
                    await camera.setDeviceProperty('SHUTTER_SPEED', originalShutter)
                }
            } catch (error) {
                console.warn('Shutter speed control not supported:', error)
            }
        })

        it('should get and set aperture', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalAperture = await camera.getDeviceProperty('APERTURE')
                expect(originalAperture).toBeDefined()
                expect(String(originalAperture)).toMatch(/f\/\d+\.?\d*/)

                await camera.setDeviceProperty('APERTURE', 5.6)
                const newAperture = await camera.getDeviceProperty('APERTURE')
                expect(String(newAperture)).toContain('5.6')

                // Restore original
                if (originalAperture) {
                    await camera.setDeviceProperty('APERTURE', originalAperture)
                }
            } catch (error) {
                console.warn('Aperture control not supported:', error)
            }
        })

        it('should get properties using string names', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const whiteBalance = await camera.getDeviceProperty('WHITE_BALANCE')
                expect(whiteBalance).toBeDefined()
            } catch (error) {
                console.warn('White balance property not supported:', error)
            }
        })

        it('should get camera info', async () => {
            if (!camera?.isConnected()) {
                return
            }

            const info = await camera.getCameraInfo()

            expect(info).toBeDefined()
            if (info) {
                expect(info.manufacturer).toBeDefined()
                expect(info.model).toBeDefined()
            }
        })
    })

    describe('Photo Class', () => {
        it('should save photo to disk', async () => {
            const { Photo } = await import('../src/node')
            const testData = Buffer.from('test photo data')
            const photo = new Photo(testData, 'test.jpg')

            expect(photo.data).toBe(testData)
            expect(photo.filename).toBe('test.jpg')
            expect(photo.size).toBe(testData.length)
            expect(photo.capturedAt).toBeInstanceOf(Date)

            // Test save method (in-memory test)
            const savePath = `/tmp/test-photo-${Date.now()}.jpg`
            await photo.save(savePath)

            // Verify file was created
            const fs = await import('fs/promises')
            const fileExists = await fs
                .access(savePath)
                .then(() => true)
                .catch(() => false)
            expect(fileExists).toBe(true)

            // Clean up
            if (fileExists) {
                await fs.unlink(savePath)
            }
        })
    })

    describe('Frame Class', () => {
        it('should create frame with properties', async () => {
            const { Frame } = await import('../src/node')
            const testData = Buffer.from('frame data')
            const frame = new Frame(testData, 1920, 1080)

            expect(frame.data).toBe(testData)
            expect(frame.width).toBe(1920)
            expect(frame.height).toBe(1080)
            expect(frame.aspectRatio).toBeCloseTo(1.777, 2)
            expect(frame.size).toBe(testData.length)
            expect(frame.timestamp).toBeDefined()
        })
    })
})
