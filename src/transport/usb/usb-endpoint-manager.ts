import { EndpointManagerInterface, EndpointConfiguration, EndpointType } from './endpoint.interface'

/**
 * USB endpoint manager implementation
 */
export class USBEndpointManager implements EndpointManagerInterface {
    private configuration: EndpointConfiguration | null = null
    private interface: any = null

    /**
     * Configure endpoints for a USB device
     */
    async configureEndpoints(device: any): Promise<EndpointConfiguration> {
        const configuration = device.configuration || device.configurations?.[0]
        if (!configuration) {
            throw new Error('No configuration available')
        }

        // Find PTP interface (class 6, subclass 1)
        let ptpInterface: any = null

        for (const intf of configuration.interfaces) {
            const alt = intf.alternates?.[0] || intf.alternate || intf.alternates[0]
            if (alt && alt.interfaceClass === 6 && alt.interfaceSubclass === 1) {
                ptpInterface = intf
                break
            }
        }

        if (!ptpInterface) {
            throw new Error('PTP interface not found')
        }

        // Claim interface
        await device.claimInterface(ptpInterface.interfaceNumber)

        // Find endpoints
        const endpoints: EndpointConfiguration = {
            bulkIn: null,
            bulkOut: null,
            interrupt: undefined,
        }

        const alternate = ptpInterface.alternates?.[0] || ptpInterface.alternate || ptpInterface.alternates[0]
        if (!alternate) {
            throw new Error('No alternate interface found')
        }

        for (const ep of alternate.endpoints) {
            if (ep.direction === 'in' && ep.type === 'bulk') {
                endpoints.bulkIn = ep
            } else if (ep.direction === 'out' && ep.type === 'bulk') {
                endpoints.bulkOut = ep
            } else if (ep.direction === 'in' && ep.type === 'interrupt') {
                console.log('[DEBUG] Found interrupt endpoint:', {
                    endpointNumber: ep.endpointNumber,
                    packetSize: ep.packetSize,
                    interval: (ep as any).interval
                })
                endpoints.interrupt = ep
            }
        }

        if (!endpoints.bulkIn || !endpoints.bulkOut) {
            throw new Error('Required bulk endpoints not found')
        }

        this.interface = ptpInterface
        this.configuration = endpoints

        return endpoints
    }

    /**
     * Release endpoints
     */
    async releaseEndpoints(): Promise<void> {
        if (!this.interface) return

        // The interface is released via device.releaseInterface() in the transport

        this.configuration = null
        this.interface = null
    }

    /**
     * Get current endpoint configuration
     */
    getConfiguration(): EndpointConfiguration | null {
        return this.configuration
    }

    private getEndpoint(type: EndpointType): any {
        if (!this.configuration) return null

        switch (type) {
            case EndpointType.BULK_IN:
                return this.configuration.bulkIn
            case EndpointType.BULK_OUT:
                return this.configuration.bulkOut
            case EndpointType.INTERRUPT:
                return this.configuration.interrupt
            default:
                return null
        }
    }
}
