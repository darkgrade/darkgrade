import { ProtocolInterface } from '@core/protocol'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { SonyAuthenticator } from '@camera/vendors/sony/sony-authenticator'
import { SonyOperations } from '@constants/vendors/sony/operations'
import { SonyProperties } from '@constants/vendors/sony/properties'
import { PTPResponses } from '@constants/ptp/responses'
import { encodePTPValue, decodePTPValue, extractPropertyFromResponse } from '@core/buffers'
import { extractSonyLiveViewJPEG } from '@camera/vendors/sony/sony-image-utils'
import { parseJPEGDimensions } from '@core/images'

/**
 * Sony camera implementation - Simplified V7 Architecture
 * Mirrors generic implementation with Sony-specific extensions
 */
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
    
    // Set Sony-specific control mode using the property system
    const dialModeProperty = SonyProperties.DIAL_MODE
    // Use the enum value directly since we know DIAL_MODE has an enum
    const hostValue = dialModeProperty.enum['HOST']
    const encodedValue = encodePTPValue(hostValue, dialModeProperty.type)
    
    const response = await this.protocol.sendOperation({
      code: SonyOperations.SET_DEVICE_PROPERTY_VALUE.code,
      parameters: [dialModeProperty.code],
      hasDataPhase: true,
      data: encodedValue,
    })

    if (response.code !== PTPResponses.OK.code) {
      console.warn('Failed to set Sony control mode, some features may not work')
    }
  }

  async getDeviceProperty<T = any>(propertyName: keyof typeof SonyProperties): Promise<T> {
    const property = SonyProperties[propertyName]
    if (!property) {
      throw new Error(`Unknown property: ${String(propertyName)}`)
    }

    const response = await this.protocol.sendOperation({
      code: SonyOperations.GET_ALL_DEVICE_PROP_DATA.code,
      parameters: [],
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Failed to get property ${propertyName}: 0x${response.code.toString(16)}`)
    }

    if (!response.data) {
      throw new Error(`No data received for property ${propertyName}`)
    }

    // Parse Sony's all-properties response to find our property
    const value = extractPropertyFromResponse(response.data, property.code)
    
    // Use property's decoder if available
    if ('decoder' in property && typeof property.decoder === 'function') {
      return property.decoder(value) as T
    }

    return decodePTPValue(value, property.type) as T
  }

  async setDeviceProperty(propertyName: keyof typeof SonyProperties, value: any): Promise<void> {
    const property = SonyProperties[propertyName]
    if (!property) {
      throw new Error(`Unknown property: ${String(propertyName)}`)
    }

    // Determine which operation to use based on property type
    // Some properties use SET_DEVICE_PROPERTY_VALUE, others use CONTROL_DEVICE_PROPERTY
    const isControlProperty = [
      'SHUTTER_BUTTON_CONTROL',
      'FOCUS_BUTTON_CONTROL',
      'LIVE_VIEW_CONTROL'
    ].includes(property.name)
    
    const operationCode = isControlProperty 
      ? SonyOperations.CONTROL_DEVICE_PROPERTY.code
      : SonyOperations.SET_DEVICE_PROPERTY_VALUE.code

    // Use property's encoder if available, or enum value if provided
    let encodedValue: Uint8Array
    if ('encoder' in property && typeof property.encoder === 'function') {
      encodedValue = property.encoder(value)
    } else if ('enum' in property && property.enum && typeof value === 'string' && value in property.enum) {
      encodedValue = encodePTPValue(property.enum[value as keyof typeof property.enum], property.type)
    } else {
      encodedValue = encodePTPValue(value, property.type)
    }

    const response = await this.protocol.sendOperation({
      code: operationCode,
      parameters: [property.code],
      hasDataPhase: true,
      data: encodedValue,
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Failed to set property ${propertyName}: 0x${response.code.toString(16)}`)
    }
  }

  /**
   * Capture an image using Sony's control properties
   */
  async captureImage(): Promise<void> {
    // Half-press shutter for focus
    await this.setDeviceProperty('SHUTTER_BUTTON_CONTROL', 'HALF_PRESS')
    
    // Wait a bit for focus
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // Full-press shutter to capture
    await this.setDeviceProperty('SHUTTER_BUTTON_CONTROL', 'FULL_PRESS')
    
    // Release shutter
    await this.setDeviceProperty('SHUTTER_BUTTON_CONTROL', 'RELEASE')
  }

  async captureLiveViewFrame(): Promise<any> {
    // Start live view if not already active
    const startResponse = await this.protocol.sendOperation({
      code: SonyOperations.GET_LIVE_VIEW_IMG.code,
      parameters: [],
    })

    if (startResponse.code !== PTPResponses.OK.code || !startResponse.data) {
      return null
    }

    // Parse Sony's live view format
    const jpegData = extractSonyLiveViewJPEG(startResponse.data)
    if (!jpegData) {
      return null
    }

    // Parse actual dimensions from JPEG
    const dimensions = parseJPEGDimensions(jpegData)

    return {
      data: jpegData,
      timestamp: Date.now(),
      width: dimensions.width,
      height: dimensions.height,
      format: 'jpeg'
    }
  }
}