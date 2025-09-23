import { TransportOptions } from '@transport/interfaces/device.interface'

/**
 * Camera connection options
 * Extends TransportOptions with camera-specific settings
 */
export interface CameraOptions extends TransportOptions {
    vendor?: string
    model?: string
    serialNumber?: string

    usb?: {
        vendorId?: number
        productId?: number
    }
    ip?: {
        host: string
        port?: number
        protocol?: 'ptp/ip' | 'upnp'
    }
}


// Photo and Frame are exported as classes from their respective files
// These interfaces are removed to avoid duplication

// ExposureMode is exported from constants/property-enums.ts to avoid duplication
