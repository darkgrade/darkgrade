/**
 * Transport layer main interface
 */

import { DeviceDescriptor } from './device.interface'
import { TransportType } from './transport-types'

export { TransportType, DeviceDescriptor }

export interface PTPEvent {
    code: number
    transactionId: number
    parameters: number[]
}

/**
 * Transport layer interface for device communication
 */
export interface TransportInterface {
    /**
     * Discover available devices for this transport
     * @returns List of available device descriptors
     */
    discover(): Promise<DeviceDescriptor[]>

    /**
     * Connect to a device
     * @param device - Optional device descriptor for connection. If not provided, discovers and connects to first available device.
     */
    connect(device?: DeviceDescriptor): Promise<void>

    /**
     * Disconnect from the current device
     */
    disconnect(): Promise<void>

    /**
     * Send data to device (COMMAND or DATA container)
     * @param data - Container data to send
     * @param sessionId - PTP session ID for logging
     * @param transactionId - PTP transaction ID for logging
     */
    send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void>

    /**
     * Receive data from device (DATA or RESPONSE container)
     * @param maxLength - Maximum number of bytes to receive
     * @param sessionId - PTP session ID for logging
     * @param transactionId - PTP transaction ID for logging
     * @returns Received container data
     */
    receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array>

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
     * Get endianness for this transport
     * USB uses little-endian (per PIMA 15740), IP uses big-endian (per PTP spec)
     */
    isLittleEndian(): boolean

    /**
     * Get connected device information
     */
    getDeviceInfo?(): DeviceDescriptor | null

    /**
     * Register handler for PTP events
     * @param handler - Callback to handle parsed event data
     */
    onEvent?(handler: (event: PTPEvent) => void): void

    /**
     * Unregister event handler
     * @param handler - Callback to remove
     */
    offEvent?(handler: (event: PTPEvent) => void): void

    /**
     * Start listening for events
     */
    startEventListening?(): Promise<void>

    /**
     * Stop listening for events
     */
    stopEventListening?(): Promise<void>

    /**
     * Get device status (USB-specific)
     */
    getDeviceStatus?(): Promise<{ code: number; parameters: number[] }>

    /**
     * Cancel a request by transaction ID (USB-specific)
     */
    cancelRequest?(transactionId: number): Promise<void>

    /**
     * Get extended event data (USB-specific)
     */
    getExtendedEventData?(bufferSize?: number): Promise<any>
}
