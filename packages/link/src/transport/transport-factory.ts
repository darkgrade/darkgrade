import { Logger } from '@core/logger'
import { TransportType } from '@transport/interfaces/transport-types'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import type { IPTransportOptions } from '@transport/ip/ip-transport'
export type { IPTransportOptions } from '@transport/ip/ip-transport'

export class TransportFactory {
    async createUSBTransport(options?: USBTransportOptions): Promise<TransportInterface> {
        const { USBTransport } = await import('./usb/usb-transport')
        const logger = new Logger({ captureConsole: false, renderInTerminal: false })
        return new USBTransport(logger, options)
    }

    async createIPTransport(options: IPTransportOptions): Promise<TransportInterface> {
        const { IPTransport } = await import('./ip/ip-transport')
        return new IPTransport(options)
    }

    create(type: TransportType.USB, options?: USBTransportOptions): Promise<TransportInterface>
    create(type: TransportType.IP, options: IPTransportOptions): Promise<TransportInterface>
    async create(type: TransportType, options?: USBTransportOptions | IPTransportOptions): Promise<TransportInterface> {
        switch (type) {
            case TransportType.USB:
                if (options && 'address' in options) throw new Error('IP options require an IP transport')
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

export interface USBTransportOptions {
    /**
     * Limit each USB bulk-IN request while reassembling the full PTP container.
     * Use 16384 while collecting Linux usbmon evidence: larger usbfs buffers can use
     * IOMMU-coalesced scatter/gather that usbmon cannot capture (flag_data='D').
     * Omit for the normal full-size transfer path.
     */
    maxBulkReadBytes?: number
    /**
     * A WebUSB implementation to use under Node in place of the one this package makes from node-usb, for example
     * `new WebUSB({ allowAllDevices: true })` from another USB library. Browsers always use `navigator.usb`.
     */
    usb?: USB
}
