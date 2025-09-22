import { ProtocolInterface } from '../../core/interfaces/protocol.interface'
import { PropertyMapperInterface } from '../interfaces/property-mapper.interface'
import { CameraInterface, PropertyDescriptor, CameraInfo, StorageInfo } from '../interfaces/camera.interface'
import { DeviceProperty, PropertyValue } from '../properties/device-properties'
import { ImageInfo, ImageData, ImageFormat } from '../interfaces/image.interface'
import { LiveViewFrame } from '../interfaces/liveview.interface'
import { PTPOperations, PTPResponses } from '../../core/ptp/ptp-constants'

/**
 * Generic PTP camera implementation
 * Provides standard PTP operations with vendor-agnostic property mapping
 */
export class GenericPTPCamera implements CameraInterface {
    protected sessionId = 1
    protected connected = false
    protected liveViewActive = false

    constructor(
        protected readonly protocol: ProtocolInterface,
        protected readonly propertyMapper: PropertyMapperInterface
    ) {}

    async connect(): Promise<void> {
        await this.protocol.openSession(this.sessionId)
        this.connected = true
    }

    async disconnect(): Promise<void> {
        if (this.liveViewActive) {
            await this.disableLiveView()
        }
        await this.protocol.closeSession()
        this.connected = false
    }

    isConnected(): boolean {
        return this.connected
    }

    async captureImage(): Promise<void> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.INITIATE_CAPTURE,
            parameters: [0, 0],
            hasDataPhase: false,
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Capture failed: 0x${response.code.toString(16)}`)
        }
    }

    async getDeviceProperty(property: DeviceProperty): Promise<PropertyValue> {
        const vendorCode = this.propertyMapper.mapToVendor(property)

        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_DEVICE_PROP_VALUE,
            parameters: [vendorCode],
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to get property ${property}: 0x${response.code.toString(16)}`)
        }

        if (!response.data) {
            throw new Error(`No data received for property ${property}`)
        }

        return this.propertyMapper.parseValue(property, response.data)
    }

    async setDeviceProperty(property: DeviceProperty, value: PropertyValue): Promise<void> {
        const vendorCode = this.propertyMapper.mapToVendor(property)
        const vendorValue = this.propertyMapper.convertValue(property, value)

        // Convert value to Uint8Array for sending
        const data = this.encodePropertyValue(vendorValue)

        const response = await this.protocol.sendOperation({
            code: PTPOperations.SET_DEVICE_PROP_VALUE,
            parameters: [vendorCode],
            hasDataPhase: true,
            data,
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to set property ${property}: 0x${response.code.toString(16)}`)
        }
    }

    async getPropertyDescriptor(property: DeviceProperty): Promise<PropertyDescriptor> {
        const vendorCode = this.propertyMapper.mapToVendor(property)

        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_DEVICE_PROP_DESC,
            parameters: [vendorCode],
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to get property descriptor: 0x${response.code.toString(16)}`)
        }

        // Parse descriptor from response data
        return this.parsePropertyDescriptor(property, response.data!)
    }

    async enableLiveView(): Promise<void> {
        // Generic implementation - vendors may override
        this.liveViewActive = true
    }

    async disableLiveView(): Promise<void> {
        // Generic implementation - vendors may override
        this.liveViewActive = false
    }

    async getLiveViewFrame(): Promise<LiveViewFrame> {
        if (!this.liveViewActive) {
            throw new Error('Live view is not active')
        }

        // Generic implementation - vendors will override
        throw new Error('Live view not implemented for generic camera')
    }

    isLiveViewActive(): boolean {
        return this.liveViewActive
    }

    async listImages(): Promise<ImageInfo[]> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_OBJECT_HANDLES,
            parameters: [0xffffffff, 0, 0], // All storage, all formats, root
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to list images: 0x${response.code.toString(16)}`)
        }

        // Parse handles from response
        const handles = this.parseHandles(response.data!)
        const images: ImageInfo[] = []

        for (const handle of handles) {
            const info = await this.getObjectInfo(handle)
            if (info) {
                images.push(info)
            }
        }

        return images
    }

    async downloadImage(handle: number): Promise<ImageData> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_OBJECT,
            parameters: [handle],
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to download image: 0x${response.code.toString(16)}`)
        }

        // Skip PTP header if present
        const data = response.data!.length > 12 ? response.data!.slice(12) : response.data!

        return {
            data,
            format: ImageFormat.JPEG, // TODO: Detect from object info
            width: 0, // TODO: Parse from object info
            height: 0,
            handle,
        }
    }

    async deleteImage(handle: number): Promise<void> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.DELETE_OBJECT,
            parameters: [handle, 0], // Handle and format (0 = don't care)
            hasDataPhase: false,
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to delete image: 0x${response.code.toString(16)}`)
        }
    }

    async getCameraInfo(): Promise<CameraInfo> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_DEVICE_INFO,
            parameters: [],
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to get device info: 0x${response.code.toString(16)}`)
        }

        return this.parseDeviceInfo(response.data!)
    }

    async getStorageInfo(): Promise<StorageInfo[]> {
        const response = await this.protocol.sendOperation({
            code: PTPOperations.GET_STORAGE_IDS,
            parameters: [],
        })

        if (response.code !== PTPResponses.OK) {
            throw new Error(`Failed to get storage IDs: 0x${response.code.toString(16)}`)
        }

        const storageIds = this.parseStorageIds(response.data!)
        const storageInfos: StorageInfo[] = []

        for (const id of storageIds) {
            const info = await this.getStorageInfoById(id)
            if (info) {
                storageInfos.push(info)
            }
        }

        return storageInfos
    }

    // Protected helper methods

    protected encodePropertyValue(value: unknown): Uint8Array {
        // Simple encoding for basic types
        if (typeof value === 'number') {
            const data = new Uint8Array(4)
            new DataView(data.buffer).setUint32(0, value, true)
            return data
        } else if (value instanceof Uint8Array) {
            return value
        } else {
            throw new Error(`Cannot encode property value of type ${typeof value}`)
        }
    }

    protected parsePropertyDescriptor(property: DeviceProperty, data: Uint8Array): PropertyDescriptor {
        // Basic parsing - vendors may override for specific formats
        const view = new DataView(data.buffer, data.byteOffset)
        let offset = 0

        view.getUint16(offset, true) // propertyCode - read but not used
        offset += 2
        const dataType = view.getUint16(offset, true)
        offset += 2
        const getSet = view.getUint8(offset)
        offset += 1

        // TODO: Parse rest of descriptor including default value, current value, form flag, etc.

        return {
            property,
            dataType,
            getSet,
            factoryDefault: '', // Use empty string instead of null
            currentValue: '', // Use empty string instead of null
            formFlag: 0,
        }
    }

    protected parseHandles(data: Uint8Array): number[] {
        const view = new DataView(data.buffer, data.byteOffset)
        const count = view.getUint32(0, true)
        const handles: number[] = []

        for (let i = 0; i < count; i++) {
            handles.push(view.getUint32(4 + i * 4, true))
        }

        return handles
    }

    protected async getObjectInfo(handle: number): Promise<ImageInfo | null> {
        try {
            const response = await this.protocol.sendOperation({
                code: PTPOperations.GET_OBJECT_INFO,
                parameters: [handle],
            })

            if (response.code !== PTPResponses.OK) {
                return null
            }

            // Parse object info
            const view = new DataView(response.data!.buffer, response.data!.byteOffset)
            let offset = 0

            const storageId = view.getUint32(offset, true)
            offset += 4
            const objectFormat = view.getUint16(offset, true)
            offset += 2
            view.getUint16(offset, true) // protectionStatus - read but not used
            offset += 2
            const compressedSize = view.getUint32(offset, true)
            offset += 4

            // Skip thumb format, compressed size, width, height, etc.
            // TODO: Parse these fields properly

            return {
                handle,
                storageId,
                objectFormat,
                protectionStatus: 0,
                objectCompressedSize: compressedSize,
                thumbFormat: 0,
                thumbCompressedSize: 0,
                thumbPixWidth: 0,
                thumbPixHeight: 0,
                imagePixWidth: 0,
                imagePixHeight: 0,
                imageBitDepth: 0,
                parentObject: 0,
                associationType: 0,
                associationDescription: 0,
                sequenceNumber: 0,
                filename: `IMG_${handle}.jpg`,
                captureDate: new Date(),
                modificationDate: new Date(),
            }
        } catch {
            return null
        }
    }

    protected parseDeviceInfo(data: Uint8Array): CameraInfo {
        // Parse PTP DeviceInfo structure
        const view = new DataView(data.buffer, data.byteOffset)
        let offset = 0
        
        // Skip standard version (2 bytes) and vendor extension ID (4 bytes)
        offset += 2 // StandardVersion
        offset += 4 // VendorExtensionID
        offset += 2 // VendorExtensionVersion
        
        // Read vendor extension description string (PTP string format)
        const vendorExtDescLength = view.getUint8(offset)
        offset += 1 + vendorExtDescLength * 2 // Skip unicode string
        
        // Skip functional mode (2 bytes)
        offset += 2
        
        // Read operations supported array
        const opsCount = view.getUint32(offset, true)
        offset += 4
        const operationsSupported = []
        for (let i = 0; i < opsCount; i++) {
            operationsSupported.push(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read events supported array
        const eventsCount = view.getUint32(offset, true)
        offset += 4
        const eventsSupported = []
        for (let i = 0; i < eventsCount; i++) {
            eventsSupported.push(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read device properties supported array
        const propsCount = view.getUint32(offset, true)
        offset += 4
        const devicePropertiesSupported = []
        for (let i = 0; i < propsCount; i++) {
            devicePropertiesSupported.push(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read capture formats array
        const captureCount = view.getUint32(offset, true)
        offset += 4
        const captureFormats = []
        for (let i = 0; i < captureCount; i++) {
            captureFormats.push(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read image formats array
        const imageCount = view.getUint32(offset, true)
        offset += 4
        const imageFormats = []
        for (let i = 0; i < imageCount; i++) {
            imageFormats.push(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read manufacturer string
        const manufacturerLength = view.getUint8(offset)
        offset++
        let manufacturer = ''
        for (let i = 0; i < manufacturerLength; i++) {
            manufacturer += String.fromCharCode(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read model string
        const modelLength = view.getUint8(offset)
        offset++
        let model = ''
        for (let i = 0; i < modelLength; i++) {
            model += String.fromCharCode(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read version string
        const versionLength = view.getUint8(offset)
        offset++
        let version = ''
        for (let i = 0; i < versionLength; i++) {
            version += String.fromCharCode(view.getUint16(offset, true))
            offset += 2
        }
        
        // Read serial number string
        const serialLength = view.getUint8(offset)
        offset++
        let serialNumber = ''
        for (let i = 0; i < serialLength; i++) {
            serialNumber += String.fromCharCode(view.getUint16(offset, true))
            offset += 2
        }
        
        return {
            manufacturer: manufacturer || 'Unknown',
            model: model || 'Unknown',
            version: version || 'Unknown',
            serialNumber: serialNumber || 'Unknown',
            operationsSupported,
            eventsSupported,
            devicePropertiesSupported,
            captureFormats,
            imageFormats,
        }
    }

    protected parseStorageIds(data: Uint8Array): number[] {
        const view = new DataView(data.buffer, data.byteOffset)
        const count = view.getUint32(0, true)
        const ids: number[] = []

        for (let i = 0; i < count; i++) {
            ids.push(view.getUint32(4 + i * 4, true))
        }

        return ids
    }

    protected async getStorageInfoById(storageId: number): Promise<StorageInfo | null> {
        try {
            const response = await this.protocol.sendOperation({
                code: PTPOperations.GET_STORAGE_INFO,
                parameters: [storageId],
            })

            if (response.code !== PTPResponses.OK) {
                return null
            }

            // Parse storage info
            const view = new DataView(response.data!.buffer, response.data!.byteOffset)
            let offset = 0

            const storageType = view.getUint16(offset, true)
            offset += 2
            const filesystemType = view.getUint16(offset, true)
            offset += 2
            const accessCapability = view.getUint16(offset, true)
            offset += 2
            const maxCapacity = view.getBigUint64(offset, true)
            offset += 8
            const freeSpaceInBytes = view.getBigUint64(offset, true)
            offset += 8
            const freeSpaceInImages = view.getUint32(offset, true)
            offset += 4

            return {
                storageId,
                storageType,
                filesystemType,
                accessCapability,
                maxCapacity,
                freeSpaceInBytes,
                freeSpaceInImages,
                storageDescription: '',
                volumeLabel: '',
            }
        } catch {
            return null
        }
    }
}
