import { Logger } from '@core/logger'
import { TransportOptions, TransportType } from '@transport/interfaces/transport-types'
import { TransportInterface } from '@transport/interfaces/transport.interface'

export class TransportFactory {
    async createUSBTransport(_options?: USBTransportOptions): Promise<TransportInterface> {
        const { USBTransport } = await import('./usb/usb-transport')
        const logger = new Logger()
        return new USBTransport(logger)
    }

    async createIPTransport(options: IPTransportOptions): Promise<TransportInterface> {
        const { IPTransport } = await import('./ip/ip-transport')
        const logger = new Logger()
        return new IPTransport(options, logger)
    }

    async create(type: TransportType, options?: USBTransportOptions | IPTransportOptions): Promise<TransportInterface> {
        switch (type) {
            case TransportType.USB:
                return await this.createUSBTransport(options)
            case TransportType.IP:
                if (!options || !('address' in options)) throw new Error('IP transport requires address')
                return await this.createIPTransport(options)
            default: {
                const exhaustive: never = type
                throw new Error(`Unknown transport type: ${String(exhaustive)}`)
            }
        }
    }
}

export interface USBTransportOptions extends TransportOptions {
    interfaceNumber?: number
    alternateInterface?: number
    claimInterface?: boolean
}

export interface IPTransportOptions extends TransportOptions {
    address: string
    port?: number
    localAddress?: string
    clientName?: string
    clientGuid?: Uint8Array
    dataPacketSize?: number
}
