import { Logger } from '@core/logger'
import { TransportOptions, TransportType } from '@transport/interfaces/transport-types'
import { TransportInterface } from '@transport/interfaces/transport.interface'

export class TransportFactory {
    async createUSBTransport(_options?: USBTransportOptions): Promise<TransportInterface> {
        const { USBTransport } = await import('./usb/usb-transport')
        const logger = new Logger()
        return new USBTransport(logger)
    }

    async createIPTransport(_options: IPTransportOptions): Promise<TransportInterface> {
        // TODO: Not implemented in old architecture
        throw new Error('IP transport not implemented in old architecture')
    }

    async create(type: TransportType, options?: USBTransportOptions | IPTransportOptions): Promise<TransportInterface> {
        switch (type) {
            case TransportType.USB:
                return await this.createUSBTransport(options)
            case TransportType.IP:
                if (!options || !('address' in options)) throw new Error('IP transport requires address')
                return await this.createIPTransport(options)
            default:
                const exhaustive: never = type
                throw new Error(`Unknown transport type: ${exhaustive}`)
        }
    }
}

interface USBTransportOptions extends TransportOptions {
    interfaceNumber?: number
    alternateInterface?: number
    claimInterface?: boolean
}

interface IPTransportOptions extends TransportOptions {
    address: string
    port: number
    protocol?: 'tcp' | 'udp'
    keepAlive?: boolean
    keepAliveInterval?: number
}
