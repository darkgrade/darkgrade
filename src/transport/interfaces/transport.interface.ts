/**
 * Transport layer interface for device communication
 */
import { DeviceDescriptor, TransportType } from '@transport/interfaces/device.interface'
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
