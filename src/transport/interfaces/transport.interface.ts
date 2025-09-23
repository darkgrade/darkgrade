/**
 * Transport layer main interface
 */

import { DeviceDescriptor } from './device.interface'
import { TransportType } from './transport-types'

// Re-export commonly used interfaces for backward compatibility
export type { DeviceDescriptor, DeviceSearchCriteria, DeviceFinderInterface } from './device.interface'
export type { EndpointManagerInterface, EndpointConfiguration } from './endpoint.interface'
export { EndpointType } from './endpoint.interface'
export { TransportType } from './transport-types'
export type { TransportOptions } from './transport-types'

/**
 * Transport layer interface for device communication
 */
export interface TransportInterface {
    /**
     * Connect to a device
     * @param device - Device descriptor for connection
     */
    connect(device: DeviceDescriptor): Promise<void>

    /**
     * Disconnect from the current device
     */
    disconnect(): Promise<void>

    /**
     * Send data to the connected device
     * @param data - Raw data to send
     */
    send(data: Uint8Array): Promise<void>

    /**
     * Receive data from the connected device
     * @param maxLength - Maximum number of bytes to receive
     * @returns Received data
     */
    receive(maxLength?: number): Promise<Uint8Array>

    /**
     * Check if currently connected to a device
     */
    isConnected(): boolean

    /**
     * Reset the transport connection
     */
    reset(): Promise<void>

    /**
     * Get transport type identifier
     */
    getType(): TransportType

    /**
     * Get connected device information
     */
    getDeviceInfo?(): DeviceDescriptor | null
}