/**
 * Endpoint management interface for transport implementations
 */
import { DeviceDescriptor, DeviceSearchCriteria } from '@transport/interfaces/device.interface'
export interface EndpointManagerInterface {
    /**
     * Configure endpoints for a device
     * @param device - Device to configure endpoints for
     */
    configureEndpoints(device: unknown): Promise<EndpointConfiguration>

    /**
     * Release endpoints
     */
    releaseEndpoints(): Promise<void>

    /**
     * Get current endpoint configuration
     */
    getConfiguration(): EndpointConfiguration | null

    /**
     * Clear endpoint halt condition
     * @param endpoint - Endpoint to clear
     */
    clearHalt(endpoint: EndpointType): Promise<void>
}

/**
 * Endpoint configuration
 */
export interface EndpointConfiguration {
    bulkIn: unknown
    bulkOut: unknown
    interrupt?: unknown
}

/**
 * Endpoint types
 */
export enum EndpointType {
    BULK_IN = 'bulk_in',
    BULK_OUT = 'bulk_out',
    INTERRUPT = 'interrupt',
}

/**
 * Device finder interface for locating devices
 */
export interface DeviceFinderInterface {
    /**
     * Find devices matching criteria
     * @param criteria - Search criteria
     */
    findDevices(criteria: DeviceSearchCriteria): Promise<DeviceDescriptor[]>

    /**
     * Request device access (for web environments)
     * @param criteria - Device selection criteria
     */
    requestDevice(criteria: DeviceSearchCriteria): Promise<DeviceDescriptor>

    /**
     * Get list of all available devices
     */
    getAllDevices(): Promise<DeviceDescriptor[]>
}

// Device interfaces moved to device.interface.ts
