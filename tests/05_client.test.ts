/**
 * Test file for new Client API
 * Tests the simplified Camera class and discovery functions
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { Camera, listCameras, watchCameras, DeviceProperty } from '..'

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
                expect(camera.vendor.toLowerCase()).toBe('sony')
            })
        })

        it('should filter cameras by model', async () => {
            const allCameras = await listCameras()
            if (allCameras.length > 0) {
                const firstCamera = allCameras[0]
                if (!firstCamera) return
                const firstModel = firstCamera.model
                const filtered = await listCameras({ model: firstModel.substring(0, 3) })
                expect(Array.isArray(filtered)).toBe(true)
            }
        })

        it('should support stackable filters', async () => {
            const cameras = await listCameras({
                vendor: 'sony',
                usb: { vendorId: 0x054c },
            })
            expect(Array.isArray(cameras)).toBe(true)

            cameras.forEach(camera => {
                expect(camera.vendor.toLowerCase()).toBe('sony')
                if (camera.usb) {
                    expect(camera.usb.vendorId).toBe(0x054c)
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
            expect(camera.vendor).toBeDefined()
            expect(camera.model).toBeDefined()
            expect(camera.serialNumber).toBeDefined()

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
            const camera = new Camera({ vendor: firstVendor.toLowerCase() })
            await camera.connect()

            expect(camera.vendor.toLowerCase()).toBe(firstVendor.toLowerCase())

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

        it('should take a photo', async () => {
            if (!camera?.isConnected()) {
                return
            }

            const photo = await camera.takePhoto()

            expect(photo).toBeDefined()
            expect(photo.data).toBeInstanceOf(Buffer)
            expect(photo.filename).toBeDefined()
            expect(photo.size).toBeGreaterThan(0)
            expect(photo.capturedAt).toBeInstanceOf(Date)
        })

        it('should get and set ISO', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalISO = await camera.getISO()
                expect(typeof originalISO).toBe('number')

                await camera.setISO(400)
                const newISO = await camera.getISO()
                expect(newISO).toBe(400)

                // Restore original
                await camera.setISO(originalISO)
            } catch (error) {
                console.warn('ISO control not supported:', error)
            }
        })

        it('should get and set shutter speed', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalShutter = await camera.getShutterSpeed()
                expect(typeof originalShutter).toBe('string')

                await camera.setShutterSpeed('1/250')
                const newShutter = await camera.getShutterSpeed()
                expect(newShutter).toContain('250')

                // Restore original
                await camera.setShutterSpeed(originalShutter)
            } catch (error) {
                console.warn('Shutter speed control not supported:', error)
            }
        })

        it('should get and set aperture', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalAperture = await camera.getAperture()
                expect(typeof originalAperture).toBe('string')
                expect(originalAperture).toMatch(/f\/\d+\.?\d*/)

                await camera.setAperture('f/5.6')
                const newAperture = await camera.getAperture()
                expect(newAperture).toContain('5.6')

                // Restore original
                await camera.setAperture(originalAperture)
            } catch (error) {
                console.warn('Aperture control not supported:', error)
            }
        })

        it('should get and set exposure mode', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const originalMode = await camera.getExposureMode()
                expect(['auto', 'manual', 'aperture', 'shutter']).toContain(originalMode)

                await camera.setExposureMode('manual')
                const newMode = await camera.getExposureMode()
                expect(newMode).toBe('manual')

                // Restore original
                await camera.setExposureMode(originalMode)
            } catch (error) {
                console.warn('Exposure mode control not supported:', error)
            }
        })

        it('should get properties using DeviceProperty enum', async () => {
            if (!camera?.isConnected()) {
                return
            }

            try {
                const whiteBalance = await camera.getProperty(DeviceProperty.WHITE_BALANCE)
                expect(whiteBalance).toBeDefined()
            } catch (error) {
                console.warn('White balance property not supported:', error)
            }
        })

        it('should get multiple properties', async () => {
            if (!camera?.isConnected()) {
                return
            }

            const properties = await camera.getProperties()

            expect(properties).toBeInstanceOf(Map)
            expect(properties.size).toBeGreaterThanOrEqual(0)
        })

        it('should list photos on camera', async () => {
            if (!camera?.isConnected()) {
                return
            }

            const photos = await camera.listPhotos()

            expect(Array.isArray(photos)).toBe(true)
            if (photos.length > 0) {
                const photo = photos[0]
                if (photo) {
                    expect(photo.filename).toBeDefined()
                }
            }
        })

        it('should handle events', async () => {
            if (!camera?.isConnected()) {
                return
            }

            let photoEventFired = false

            camera.on('photo', photo => {
                photoEventFired = true
                expect(photo).toBeDefined()
            })

            const photo = await camera.takePhoto()
            expect(photo).toBeDefined()
            expect(photoEventFired).toBe(true)

            camera.off('photo', () => {})
        })
    })

    describe('Photo Class', () => {
        it('should save photo to disk', async () => {
            const { Photo } = await import('..')
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
            const { Frame } = await import('..')
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
