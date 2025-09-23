/**
 * Endpoint-related interfaces and types
 */

/**
 * Endpoint management interface for transport implementations
 */
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