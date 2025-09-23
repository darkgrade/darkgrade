import { TransportFactory } from '@transport/transport-factory'
import { CameraFactory } from '@camera/camera-factory'
import { CameraInterface } from '@camera/interfaces/camera.interface'
import { TransportType, DeviceDescriptor } from '@transport/interfaces/device.interface'
import { listCameras } from '@client/discovery'
import { CameraOptions } from '@client/types'
import { Photo } from '@client/photo'
import { Frame } from '@client/frame'

/**
 * High-level Camera API - simplified wrapper around GenericPTPCamera
 * Provides auto-discovery and convenience methods
 */
export class Camera {
    private options: CameraOptions
    private cameraImplementation?: CameraInterface
    private transportFactory: TransportFactory
    private cameraFactory: CameraFactory
    private deviceDescriptor?: DeviceDescriptor

    constructor(options?: CameraOptions | DeviceDescriptor) {
        this.options = options || {}
        this.transportFactory = new TransportFactory()
        this.cameraFactory = new CameraFactory()
    }

    async connect(): Promise<void> {
        const isWebEnvironment = typeof window !== 'undefined'
        
        if (!this.options.usb?.productId && !this.options.ip?.host) {
            if (isWebEnvironment) {
                // In browser, we need to request device permission
                // The transport will handle this via requestDevice
                // We'll pass vendorId 0 to trigger auto-discovery
                this.options.usb = { vendorId: 0, productId: 0 }
            } else {
                // In Node.js, use listCameras for auto-discovery
                const cameras = await listCameras(this.options)

                if (cameras.length === 0) {
                    const filters = []
                    if (this.options.vendor) filters.push(`vendor: ${this.options.vendor}`)
                    if (this.options.model) filters.push(`model: ${this.options.model}`)
                    if (this.options.usb?.vendorId) filters.push(`USB vendor: 0x${this.options.usb.vendorId.toString(16)}`)

                    const filterMsg = filters.length > 0 ? ` matching filters: ${filters.join(', ')}` : ''
                    throw new Error(`No cameras found${filterMsg}. Please connect a camera via USB.`)
                }

                const firstCamera = cameras[0]
                if (firstCamera) {
                    this.options = { ...this.options, ...firstCamera }
                    this.deviceDescriptor = firstCamera
                }
            }
        }

        await this.establishConnection()
    }

    private async establishConnection(): Promise<void> {
        if (this.options.ip) {
            throw new Error('IP connections not yet implemented')
        }

        const transport = await this.transportFactory.create(TransportType.USB, {
            timeout: this.options.timeout,
        })

        await transport.connect({
            vendorId: this.options.usb?.vendorId || 0,
            productId: this.options.usb?.productId || 0,
            serialNumber: this.options.serialNumber,
        })

        // Get the actual device info from transport (important for WebUSB auto-discovery)
        const deviceInfo = transport.getDeviceInfo?.()
        if (deviceInfo) {
            this.deviceDescriptor = {
                ...this.deviceDescriptor,
                ...deviceInfo
            }
        }

        const detectedVendor =
            this.options.vendor ||
            this.cameraFactory.detectVendor(this.options.usb?.vendorId || 0, this.options.usb?.productId || 0)
        
        this.cameraImplementation = this.cameraFactory.create(detectedVendor, transport)
        await this.cameraImplementation.connect()

        // Update device descriptor with camera info
        try {
            const cameraInfo = await this.cameraImplementation.getCameraInfo()
            this.deviceDescriptor = {
                ...this.deviceDescriptor,
                manufacturer: cameraInfo.manufacturer,
                model: cameraInfo.model,
                serialNumber: cameraInfo.serialNumber,
                firmwareVersion: cameraInfo.firmwareVersion,
                batteryLevel: cameraInfo.batteryLevel,
                vendor: cameraInfo.manufacturer
            }
        } catch (error) {
            console.warn('[Camera] Could not retrieve camera info:', error)
            if (!this.deviceDescriptor) {
                this.deviceDescriptor = {
                    manufacturer: detectedVendor,
                    model: 'Unknown',
                    vendor: detectedVendor
                }
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.cameraImplementation) {
            await this.cameraImplementation.disconnect()
            this.cameraImplementation = undefined
        }
    }

    isConnected(): boolean {
        return this.cameraImplementation?.isConnected() || false
    }

    // Simple getters that delegate to the underlying camera implementation
    async getCameraInfo() {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        return this.cameraImplementation.getCameraInfo()
    }

    async getStorageInfo() {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        return this.cameraImplementation.getStorageInfo()
    }

    async captureImage(): Promise<void> {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        return this.cameraImplementation.captureImage()
    }

    async captureLiveViewFrame() {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        const frame = await this.cameraImplementation.captureLiveViewFrame()
        if (frame) {
            return new Frame(
                Buffer.from(frame.data),
                frame.width,
                frame.height,
                frame.timestamp
            )
        }
        return null
    }

    async getDeviceProperty<T = any>(propertyName: string): Promise<T> {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        return this.cameraImplementation.getDeviceProperty(propertyName)
    }

    async setDeviceProperty(propertyName: string, value: any): Promise<void> {
        if (!this.cameraImplementation) throw new Error('Camera not connected')
        return this.cameraImplementation.setDeviceProperty(propertyName, value)
    }

    // Convenience method for simple photo capture
    async takePhoto(): Promise<Photo> {
        await this.captureImage()
        // Return a placeholder photo indicating success
        return new Photo(Buffer.from(''), 'capture_successful.jpg')
    }
}
