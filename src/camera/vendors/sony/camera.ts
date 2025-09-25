import { ProtocolInterface } from '@core/protocol'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { SonyProperties } from '@constants/vendors/sony/properties'
import { SonyFormats } from '@constants/vendors/sony/formats'
import { PTPResponses } from '@constants/ptp/responses'
import { encodePTPValue } from '@core/buffers'
import { parseSDIExtDevicePropInfo } from '@camera/vendors/sony/sdi-ext-device-prop-info-dataset'
import { parseLiveViewDataset } from '@camera/vendors/sony/sony-live-view-dataset'
import { ObjectInfoParsed, parseObjectInfo } from '@camera/generic/object-info-dataset'

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

export class SonyCamera extends GenericPTPCamera {
    private liveViewEnabled = false

    constructor(
        protocol: ProtocolInterface,
        private readonly authenticator: SonyAuthenticator
    ) {
        super(protocol)
    }

    async connect(): Promise<void> {
        // Call parent connect to open session first
        await super.connect()

        // Perform authentication after session is open
        await this.authenticator.authenticate(this.protocol)

        // Set the host as the priority for settings
        const response = await this.protocol.sendOperation({
            ...SonyOperations.SDIO_SET_EXT_DEVICE_PROP_VALUE,
            parameters: [SonyProperties.POSITION_KEY_SETTING.code],
            data: encodePTPValue(
                SonyProperties.POSITION_KEY_SETTING.enum.HOST_PRIORITY,
                SonyProperties.POSITION_KEY_SETTING.type
            ),
        })

        if (response.code !== PTPResponses.OK.code) {
            console.warn('Failed to set Sony control mode, some features may not work')
        }

        await this.setDeviceProperty('STILL_IMAGE_SAVE_DESTINATION', 'CAMERA_DEVICE')
    }

    async disconnect(): Promise<void> {
        await super.disconnect()
    }

    async getDeviceProperty<T = any>(propertyName: keyof typeof SonyProperties): Promise<T> {
        const property = SonyProperties[propertyName]
        if (!property) {
            throw new Error(`Unknown property: ${String(propertyName)}`)
        }

        if (propertyName === 'EXPOSURE') {
            const meteredExposure = await this.getDeviceProperty('METERED_EXPOSURE')
            const exposureCompensation = await this.getDeviceProperty('EXPOSURE_COMPENSATION')
            return meteredExposure !== '0 EV' ? meteredExposure : exposureCompensation
        }

        const response = await this.protocol.sendOperation({
            ...SonyOperations.SDIO_GET_EXT_DEVICE_PROP_VALUE,
            parameters: [property.code],
        })

        if (response.code !== PTPResponses.OK.code) {
            throw new Error(`Failed to get property ${propertyName}: 0x${response.code.toString(16)}`)
        }

        if (!response.data) {
            throw new Error(`No data received for property ${propertyName}`)
        }

        // Parse Sony's all-properties response to find our property
        const value = parseSDIExtDevicePropInfo(response.data)
        console.log(
            `  Got raw value for ${propertyName}:`,
            Array.from(value.currentValueBytes)
                .map(b => '0x' + b.toString(16).padStart(2, '0'))
                .join(' ')
        )

        // Decode the value if the property has a decode function
        if ('decode' in property && typeof property.decode === 'function') {
            const decoded = property.decode(value.currentValueBytes) as T
            console.log(`  Decoded ${propertyName} to: "${decoded}"`)
            return decoded
        }

        // If property has enum, try to decode using it
        if ('enum' in property && property.enum) {
            const rawValue = value.currentValueRaw
            // Find the enum key that matches this value
            const enumEntry = Object.entries(property.enum).find(([_, enumValue]) => enumValue === rawValue)
            if (enumEntry) {
                const [enumKey] = enumEntry
                console.log(`  Decoded ${propertyName} enum value 0x${rawValue.toString(16)} to: "${enumKey}"`)
                return enumKey as T
            }
        }

        return value.currentValueRaw as T
    }

    async setDeviceProperty(propertyName: keyof typeof SonyProperties, value: any): Promise<void> {
        const property = SonyProperties[propertyName]
        if (!property) {
            throw new Error(`Unknown property: ${String(propertyName)}`)
        }

        // Determine which operation to use based on property type
        // Some properties use SET_DEVICE_PROPERTY_VALUE, others use CONTROL_DEVICE_PROPERTY
        // Control properties are button-like actions, not settings
        const isControlProperty = /shutter|focus|^SET_LIVE_VIEW_ENABLE$/i.test(property.name)
        console.log('isControlProperty', isControlProperty, property.name)

        const operation = isControlProperty
            ? SonyOperations.SDIO_CONTROL_DEVICE
            : SonyOperations.SDIO_SET_EXT_DEVICE_PROP_VALUE

        // Use property's encode if available, or enum value if provided
        let encodedValue: Uint8Array
        if ('encode' in property && typeof property.encode === 'function') {
            encodedValue = property.encode(value)
            console.log(
                `  Encoded ${propertyName} value "${value}" to:`,
                Array.from(encodedValue)
                    .map(b => '0x' + b.toString(16).padStart(2, '0'))
                    .join(' ')
            )
        } else if ('enum' in property && property.enum && typeof value === 'string' && value in property.enum) {
            encodedValue = encodePTPValue(property.enum[value as keyof typeof property.enum], property.type)
        } else {
            encodedValue = encodePTPValue(value, property.type)
        }

        const response = await this.protocol.sendOperation({
            ...operation,
            parameters: [property.code],
            data: encodedValue,
        })

        if (response.code !== PTPResponses.OK.code) {
            console.log(`  Failed to set ${propertyName} to "${value}", response code: 0x${response.code.toString(16)}`)
            throw new Error(`Failed to set property ${propertyName}: 0x${response.code.toString(16)}`)
        }
        console.log(`  Successfully set ${propertyName} to "${value}"`)
    }

    /**
     * Capture an image using Sony's control properties
     */
    async captureImage(): Promise<{ info: ObjectInfoParsed; data: Uint8Array } | null> {
        await this.setDeviceProperty('SHUTTER_HALF_RELEASE_BUTTON', 'DOWN')
        await new Promise(resolve => setTimeout(resolve, 500))
        await this.setDeviceProperty('SHUTTER_RELEASE_BUTTON', 'DOWN')
        await this.setDeviceProperty('SHUTTER_RELEASE_BUTTON', 'UP')
        await this.setDeviceProperty('SHUTTER_HALF_RELEASE_BUTTON', 'UP')

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfo = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT_INFO,
            parameters: [SONY_CAPTURED_IMAGE_OBJECT_HANDLE],
        })

        const objectInfoParsed = parseObjectInfo(objectInfo.data!)
        const objectCompressedSize = objectInfoParsed.objectCompressedSize

        const response = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT,
            parameters: [SONY_CAPTURED_IMAGE_OBJECT_HANDLE],
            maxDataLength: objectCompressedSize + 1024, // Add buffer
        })

        return response.data
            ? {
                  info: objectInfoParsed,
                  data: response.data,
              }
            : null
    }

    async captureLiveView(): Promise<{ info: ObjectInfoParsed; data: Uint8Array } | null> {
        if (!this.liveViewEnabled) {
            await this.setDeviceProperty('SET_LIVE_VIEW_ENABLE', 'ENABLE')
            this.liveViewEnabled = true
        }

        // Add delay to allow live view to initialize
        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfo = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT_INFO,
            parameters: [SONY_LIVE_VIEW_OBJECT_HANDLE],
        })

        await new Promise(resolve => setTimeout(resolve, 500))

        const objectInfoParsed = parseObjectInfo(objectInfo.data!)
        const objectCompressedSize = objectInfoParsed.objectCompressedSize
        const objectFormat = objectInfoParsed.objectFormat
        const sonyFormatInfo = Object.values(SonyFormats).find(f => f.code === objectFormat)

        const response = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT,
            parameters: [SONY_LIVE_VIEW_OBJECT_HANDLE],
            maxDataLength: objectCompressedSize + 1024, // Add buffer
        })

        // Parse Sony's live view format
        const liveViewData = parseLiveViewDataset(response.data!)

        return liveViewData.liveViewImage
            ? {
                  info: {
                      ...objectInfoParsed,
                      objectFormat: sonyFormatInfo?.code || objectFormat,
                      objectFormatName: sonyFormatInfo?.name || 'Unknown',
                      objectFormatDescription: sonyFormatInfo?.description || 'Unknown',
                  },
                  data: liveViewData.liveViewImage,
              }
            : null
    }

    /**
     * TODO: bad name, it's not a stream, it's a frame, but the way we capture and process
     * these is way, way faster than captureLiveView
     */
    async streamLiveView(): Promise<Uint8Array> {
        if (!this.liveViewEnabled) {
            await this.setDeviceProperty('SET_LIVE_VIEW_ENABLE', 'ENABLE')
            this.liveViewEnabled = true
        }

        const response = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT,
            parameters: [SONY_LIVE_VIEW_OBJECT_HANDLE],
            maxDataLength: 256 * 1024, // 256KB
        })

        // Parse Sony's live view format
        const liveViewData = parseLiveViewDataset(response.data!)

        return liveViewData.liveViewImage || new Uint8Array()
    }
}
