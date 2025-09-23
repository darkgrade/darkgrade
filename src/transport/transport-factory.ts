import { TransportInterface } from '@transport/interfaces/transport.interface'
import { TransportType, TransportOptions } from '@transport/interfaces/device.interface'
import { DeviceFinderInterface, EndpointManagerInterface } from '@transport/interfaces/endpoint.interface'

/**
 * Transport factory for creating transport implementations
 */
export class TransportFactory {
    /**
     * Create a USB transport instance
     * @param options - USB transport options
     */
    async createUSBTransport(_options?: USBTransportOptions): Promise<TransportInterface> {
        // Dynamic import for USB transport (Node.js only)
        const { USBTransport } = await import('./usb/usb-transport')
        const deviceFinder = await this.createUSBDeviceFinder()
        const endpointManager = await this.createUSBEndpointManager()
        return new USBTransport(deviceFinder, endpointManager)
    }

    /**
     * Create an IP transport instance
     * @param options - IP transport options
     */
    async createIPTransport(_options: IPTransportOptions): Promise<TransportInterface> {
        // TODO: Not implemented in old architecture
        throw new Error('IP transport not implemented in old architecture')
    }

    /**
     * Create a transport instance by type
     * @param type - Transport type
     * @param options - Transport options
     */
    async create(type: TransportType, options?: unknown): Promise<TransportInterface> {
        switch (type) {
            case TransportType.USB:
                return await this.createUSBTransport(options as USBTransportOptions)
            case TransportType.IP:
                return await this.createIPTransport(options as IPTransportOptions)
            default:
                throw new Error(`Unknown transport type: ${type as string}`)
        }
    }

    /**
     * Create a device finder for USB devices
     */
    async createUSBDeviceFinder(): Promise<DeviceFinderInterface> {
        const { USBDeviceFinder } = await import('./usb/usb-device-finder')
        return new USBDeviceFinder()
    }

    /**
     * Create an endpoint manager for USB devices
     */
    async createUSBEndpointManager(): Promise<EndpointManagerInterface> {
        const { USBEndpointManager } = await import('./usb/usb-endpoint-manager')
        return new USBEndpointManager()
    }
}

/**
 * USB transport options
 */
export interface USBTransportOptions extends TransportOptions {
    interfaceNumber?: number
    alternateInterface?: number
    claimInterface?: boolean
}

/**
 * IP transport options
 */
export interface IPTransportOptions extends TransportOptions {
    address: string
    port: number
    protocol?: 'tcp' | 'udp'
    keepAlive?: boolean
    keepAliveInterval?: number
}
