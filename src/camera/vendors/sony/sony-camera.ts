import { ProtocolInterface } from '../../../core/interfaces/protocol.interface'
import { GenericPTPCamera } from '../../generic/generic-ptp-camera'
import { LiveViewFrame, FrameFormat } from '../../interfaces/liveview.interface'
import { SonyAuthenticator } from './sony-authenticator'
import { 
  SonyOperations,
  SonyProperties
} from '@constants/vendors/sony'
import { PTPResponses } from '@constants'

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
    const encodedValue = this.encodePropertyValue(hostValue, dialModeProperty.type)
    
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

    // Parse Sony's all-properties response to find our property inline
    const data = response.data
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0
    let value = new Uint8Array()

    while (offset < data.length - 4) {
      const code = view.getUint16(offset, true)
      const size = view.getUint16(offset + 2, true)
      
      if (code === property.code) {
        value = data.slice(offset + 4, offset + 4 + size)
        break
      }
      
      offset += 4 + size
    }
    
    // Use property's decoder if available
    if ('decoder' in property && typeof property.decoder === 'function') {
      return property.decoder(value) as T
    }

    return this.decodePropertyValue(value, property.type) as T
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
      encodedValue = this.encodePropertyValue(property.enum[value as keyof typeof property.enum], property.type)
    } else {
      encodedValue = this.encodePropertyValue(value, property.type)
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

  async captureLiveViewFrame(): Promise<LiveViewFrame | null> {
    // Start live view if not already active
    const startResponse = await this.protocol.sendOperation({
      code: SonyOperations.GET_LIVE_VIEW_IMG.code,
      parameters: [],
    })

    if (startResponse.code !== PTPResponses.OK.code || !startResponse.data) {
      return null
    }

    // Parse Sony's live view format inline
    const data = startResponse.data
    
    // Sony live view data has a header followed by JPEG data
    if (data.length < 136) {
      return null
    }

    // Skip header (136 bytes for Sony)
    const jpegStart = 136
    const jpegData = data.slice(jpegStart)

    // Verify JPEG start marker
    if (jpegData[0] !== 0xFF || jpegData[1] !== 0xD8) {
      return null
    }

    return {
      data: jpegData,
      timestamp: Date.now(),
      width: 640,  // These should be parsed from header
      height: 480, // These should be parsed from header
      format: FrameFormat.JPEG
    }
  }
}

// Commented out and moved to bottom - kept for reference
/*
private parsePropertyFromAllData(data: Uint8Array, propertyCode: number): Uint8Array {
  // Sony's all-properties format includes multiple properties
  // This is a simplified parser - real implementation would need proper parsing
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 0

  while (offset < data.length - 4) {
    const code = view.getUint16(offset, true)
    const size = view.getUint16(offset + 2, true)
    
    if (code === propertyCode) {
      return data.slice(offset + 4, offset + 4 + size)
    }
    
    offset += 4 + size
  }

  return new Uint8Array()
}
*/