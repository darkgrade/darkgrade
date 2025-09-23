/**
 * Transport types and configuration
 */

/**
 * Transport type enumeration
 */
export enum TransportType {
    USB = 'usb',
    IP = 'ip',
}

/**
 * Transport configuration options
 */
export interface TransportOptions {
    timeout?: number
    maxRetries?: number
    bufferSize?: number
}