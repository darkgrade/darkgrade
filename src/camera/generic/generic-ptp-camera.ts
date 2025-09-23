import { ProtocolInterface } from '../../core/interfaces/protocol.interface'
import { CameraInterface, CameraInfo, StorageInfo } from '../interfaces/camera.interface'
import { LiveViewFrame } from '../interfaces/liveview.interface'
import { 
  PTPOperations, 
  PTPResponses, 
  PTPProperties
} from '@constants'

/**
 * Generic PTP camera implementation - Simplified V7 Architecture
 * Core operations only, direct constant usage
 */
export class GenericPTPCamera implements CameraInterface {
  protected sessionId = 1
  protected connected = false

  constructor(
    protected readonly protocol: ProtocolInterface
  ) {}

  async connect(): Promise<void> {
    await this.protocol.openSession(this.sessionId)
    this.connected = true
  }

  async disconnect(): Promise<void> {
    await this.protocol.closeSession()
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  async captureImage(): Promise<void> {
    const response = await this.protocol.sendOperation({
      code: PTPOperations.INITIATE_CAPTURE.code,
      parameters: [0, 0], // storageId: 0, objectFormat: 0
      hasDataPhase: false,
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Capture failed: 0x${response.code.toString(16)}`)
    }
  }

  async getDeviceProperty<T = any>(propertyName: keyof typeof PTPProperties): Promise<T> {
    const property = PTPProperties[propertyName]
    if (!property) {
      throw new Error(`Unknown property: ${String(propertyName)}`)
    }

    const response = await this.protocol.sendOperation({
      code: PTPOperations.GET_DEVICE_PROP_VALUE.code,
      parameters: [property.code],
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Failed to get property ${propertyName}: 0x${response.code.toString(16)}`)
    }

    if (!response.data) {
      throw new Error(`No data received for property ${propertyName}`)
    }

    // Use property's decoder if available
    if ('decoder' in property && typeof property.decoder === 'function') {
      return property.decoder(response.data) as T
    }

    // Basic decoding for common types
    return this.decodePropertyValue(response.data, property.type) as T
  }

  async setDeviceProperty(propertyName: keyof typeof PTPProperties, value: any): Promise<void> {
    const property = PTPProperties[propertyName]
    if (!property) {
      throw new Error(`Unknown property: ${String(propertyName)}`)
    }

    // Use property's encoder if available
    const data = ('encoder' in property && typeof property.encoder === 'function')
      ? property.encoder(value)
      : this.encodePropertyValue(value, property.type)

    const response = await this.protocol.sendOperation({
      code: PTPOperations.SET_DEVICE_PROP_VALUE.code,
      parameters: [property.code],
      hasDataPhase: true,
      data,
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Failed to set property ${propertyName}: 0x${response.code.toString(16)}`)
    }
  }

  async getCameraInfo(): Promise<CameraInfo> {
    const response = await this.protocol.sendOperation({
      code: PTPOperations.GET_DEVICE_INFO.code,
    })

    if (response.code !== PTPResponses.OK.code) {
      throw new Error(`Failed to get device info: 0x${response.code.toString(16)}`)
    }

    // Parse device info inline (basic implementation)
    // const data = response.data || new Uint8Array()
    // TODO: Properly parse device info from response data
    const info = {
      manufacturer: 'Generic',
      model: 'PTP Camera',
      serialNumber: '',
      deviceVersion: '1.0',
    }
    // TODO: Properly parse device info from response data
    
    // Try to get battery level
    let batteryLevel = 0
    try {
      batteryLevel = await this.getDeviceProperty('BATTERY_LEVEL')
    } catch {
      // Battery level not supported
    }
    
    return {
      manufacturer: info.manufacturer || 'Unknown',
      model: info.model || 'Unknown',
      serialNumber: info.serialNumber || '',
      firmwareVersion: info.deviceVersion || '',
      batteryLevel,
    }
  }

  async getStorageInfo(): Promise<StorageInfo[]> {
    const idsResponse = await this.protocol.sendOperation({
      code: PTPOperations.GET_STORAGE_IDS.code,
    })

    if (idsResponse.code !== PTPResponses.OK.code) {
      return []
    }

    // Parse storage IDs inline
    const idsData = idsResponse.data || new Uint8Array()
    const storageIds: number[] = []
    if (idsData.length >= 4) {
      const view = new DataView(idsData.buffer, idsData.byteOffset, idsData.byteLength)
      const count = view.getUint32(0, true)
      
      for (let i = 0; i < count && (i + 1) * 4 + 4 <= idsData.length; i++) {
        storageIds.push(view.getUint32(4 + i * 4, true))
      }
    }

    const storageInfos: StorageInfo[] = []

    for (const id of storageIds) {
      const infoResponse = await this.protocol.sendOperation({
        code: PTPOperations.GET_STORAGE_INFO.code,
        parameters: [id],
      })

      if (infoResponse.code === PTPResponses.OK.code && infoResponse.data) {
        // Parse storage info inline (basic implementation)
        const data = infoResponse.data
        data // Mark as used
        const info = {
          storageType: 0,
          storageDescription: 'Storage',
          maxCapacity: 0,
          freeSpaceInBytes: 0,
        }
        // TODO: Properly parse storage info from response data
        
        storageInfos.push({
          id: id.toString(16),
          name: info.storageDescription || `Storage ${id}`,
          type: info.storageType || 0,
          totalSpace: info.maxCapacity || 0,
          freeSpace: info.freeSpaceInBytes || 0,
        })
      }
    }

    return storageInfos
  }

  async captureLiveViewFrame(): Promise<LiveViewFrame | null> {
    // Generic PTP doesn't have standard live view
    // Subclasses should override this for vendor-specific implementations
    return null
  }

  // Helper methods for encoding/decoding

  protected encodePropertyValue(value: any, dataType: number): Uint8Array {
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    
    switch (dataType) {
      case 0x0001: // UINT8
        view.setUint8(0, value)
        return new Uint8Array(buffer, 0, 1)
      case 0x0002: // INT8
        view.setInt8(0, value)
        return new Uint8Array(buffer, 0, 1)
      case 0x0003: // UINT16
        view.setUint16(0, value, true)
        return new Uint8Array(buffer, 0, 2)
      case 0x0004: // INT16
        view.setInt16(0, value, true)
        return new Uint8Array(buffer, 0, 2)
      case 0x0005: // UINT32
        view.setUint32(0, value, true)
        return new Uint8Array(buffer, 0, 4)
      case 0x0006: // INT32
        view.setInt32(0, value, true)
        return new Uint8Array(buffer, 0, 4)
      case 0xFFFF: // STRING
        const encoder = new TextEncoder()
        const utf8 = encoder.encode(value)
        const result = new Uint8Array(2 + utf8.length)
        result[0] = utf8.length & 0xff
        result[1] = (utf8.length >> 8) & 0xff
        result.set(utf8, 2)
        return result
      default:
        return new Uint8Array()
    }
  }

  protected decodePropertyValue(data: Uint8Array, dataType: number): any {
    if (data.length === 0) return null
    
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    
    switch (dataType) {
      case 0x0001: // UINT8
        return view.getUint8(0)
      case 0x0002: // INT8
        return view.getInt8(0)
      case 0x0003: // UINT16
        return view.getUint16(0, true)
      case 0x0004: // INT16
        return view.getInt16(0, true)
      case 0x0005: // UINT32
        return view.getUint32(0, true)
      case 0x0006: // INT32
        return view.getInt32(0, true)
      case 0xFFFF: // STRING
        if (data.length < 2) return ''
        const length = view.getUint16(0, true)
        const decoder = new TextDecoder()
        return decoder.decode(data.slice(2, 2 + length))
      default:
        return null
    }
  }
}