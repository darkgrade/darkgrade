import { ProtocolInterface } from '@core/protocol'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { SonyProperties } from '@constants/vendors/sony/properties'
import { PTPResponses } from '@constants/ptp/responses'
import { encodePTPValue } from '@core/buffers'
import { parseSDIExtDevicePropInfo } from '@camera/vendors/sony/sdi-ext-device-prop-info-dataset'
import { parseLiveViewDataset } from '@camera/vendors/sony/sony-live-view-dataset'

const SONY_CAPTURED_IMAGE_OBJECT_HANDLE = 0xffffc001
const SONY_LIVE_VIEW_OBJECT_HANDLE = 0xffffc002

export class SonyCamera extends GenericPTPCamera {
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
    }

    async disconnect(): Promise<void> {
        await super.disconnect()
    }

    async getDeviceProperty<T = any>(propertyName: keyof typeof SonyProperties): Promise<T> {
        const property = SonyProperties[propertyName]
        if (!property) {
            throw new Error(`Unknown property: ${String(propertyName)}`)
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

        // Decode the value if the property has a decode function
        if ('decode' in property && typeof property.decode === 'function') {
            return property.decode(value.currentValueBytes) as T
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
        const isControlProperty = /shutter|focus|live_view/i.test(property.name)

        const operation = isControlProperty
            ? SonyOperations.SDIO_CONTROL_DEVICE
            : SonyOperations.SDIO_SET_EXT_DEVICE_PROP_VALUE

        // Use property's encode if available, or enum value if provided
        let encodedValue: Uint8Array
        if ('encode' in property && typeof property.encode === 'function') {
            encodedValue = property.encode(value)
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
            throw new Error(`Failed to set property ${propertyName}: 0x${response.code.toString(16)}`)
        }
    }

    /**
     * Capture an image using Sony's control properties
     */
    async captureImage(): Promise<Uint8Array | null> {
        await this.setDeviceProperty('SHUTTER_HALF_RELEASE_BUTTON', 'DOWN')
        await new Promise(resolve => setTimeout(resolve, 250))
        await this.setDeviceProperty('SHUTTER_RELEASE_BUTTON', 'DOWN')
        await this.setDeviceProperty('SHUTTER_RELEASE_BUTTON', 'UP')
        await this.setDeviceProperty('SHUTTER_HALF_RELEASE_BUTTON', 'UP')

        const response = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT,
            parameters: [SONY_CAPTURED_IMAGE_OBJECT_HANDLE],
        })

        return response.data || null
    }

    async captureLiveView(): Promise<Uint8Array | null> {
        // Start live view if not already active
        await this.setDeviceProperty('SET_LIVE_VIEW_ENABLE', 'ENABLE')

        const response = await this.protocol.sendOperation({
            ...SonyOperations.GET_OBJECT,
            parameters: [SONY_LIVE_VIEW_OBJECT_HANDLE],
        })

        if (response.code !== PTPResponses.OK.code) {
            throw new Error(`Failed to get live view: 0x${response.code.toString(16)}`)
        }

        if (!response.data) {
            throw new Error(`No data received for live view`)
        }

        // Parse Sony's live view format
        const jpegData = parseLiveViewDataset(response.data)
        if (!jpegData) {
            return null
        }

        return jpegData.liveViewImage
    }
}
