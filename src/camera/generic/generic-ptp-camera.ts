import { ProtocolInterface } from '@core/protocol'
import { CameraInterface, CameraInfo, StorageInfo } from '@camera/interfaces/camera.interface'
import { DeviceDescriptor } from '@transport/interfaces/transport.interface'
import { PTPOperations } from '@constants/ptp/operations'
import { PTPResponses } from '@constants/ptp/responses'
import { PTPProperties } from '@constants/ptp/properties'
import { EventEmitter } from '@api/event-emitter'
import { encodePTPValue, decodePTPValue, parsePTPUint32Array } from '@core/buffers'

/**
 * Generic PTP camera implementation - Simplified V7 Architecture
 * Combines core PTP operations with high-level convenience methods
 */
export class GenericPTPCamera extends EventEmitter implements CameraInterface {
  protected sessionId = 1
  protected connected = false
  protected deviceInfo?: DeviceDescriptor

  constructor(
    protected readonly protocol: ProtocolInterface,
    deviceInfo?: DeviceDescriptor
  ) {
    super()
    this.deviceInfo = deviceInfo
  }

  async connect(): Promise<void> {
    await this.protocol.openSession(this.sessionId)
    this.connected = true
    
    // Update device info with camera-specific details
    try {
      const cameraInfo = await this.getCameraInfo()
      if (this.deviceInfo) {
        this.deviceInfo.manufacturer = cameraInfo.manufacturer
        this.deviceInfo.model = cameraInfo.model
        this.deviceInfo.serialNumber = cameraInfo.serialNumber
        this.deviceInfo.firmwareVersion = cameraInfo.firmwareVersion
        this.deviceInfo.batteryLevel = cameraInfo.batteryLevel
      }
    } catch (error) {
      console.warn('[GenericPTPCamera] Could not retrieve camera info:', error)
    }
    
    this.emit('connect', this.deviceInfo)
  }

  async disconnect(): Promise<void> {
    await this.protocol.closeSession()
    this.connected = false
    this.emit('disconnect')
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
    
    this.emit('capture')
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

    // Use property's decode if available
    if ('decode' in property && typeof property.decode === 'function') {
      return property.decode(response.data) as T
    }

    // Basic decoding for common types
    return decodePTPValue(response.data, property.type) as T
  }

  async setDeviceProperty(propertyName: keyof typeof PTPProperties, value: any): Promise<void> {
    const property = PTPProperties[propertyName]
    if (!property) {
      throw new Error(`Unknown property: ${String(propertyName)}`)
    }

    // Use property's encode if available
    const data = ('encode' in property && typeof property.encode === 'function')
      ? property.encode(value)
      : encodePTPValue(value, property.type)

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

    // Parse device info from response data
    // Note: Full device info parsing will be implemented when needed
    // For now, return basic info structure
    const info = {
      manufacturer: 'Generic',
      model: 'PTP Camera',
      serialNumber: '',
      deviceVersion: '1.0',
    }
    
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

    // Parse storage IDs
    const idsData = idsResponse.data || new Uint8Array()
    const storageIds = parsePTPUint32Array(idsData)

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

  async captureLiveViewFrame(): Promise<any> {
    // Generic PTP doesn't have standard live view
    // Subclasses should override this for vendor-specific implementations
    return null
  }

}