export interface DeviceDescriptor {
    usb?: {
        filters: Array<{
            vendorId?: number
            productId?: number
            classCode?: number
            subclassCode?: number
            protocolCode?: number
            serialNumber?: string
        }>
        exclusionFilters?: Array<{
            vendorId?: number
            productId?: number
            classCode?: number
            subclassCode?: number
            protocolCode?: number
            serialNumber?: string
        }>
    }
    ip?: {
        host: string
        port?: number
        protocol?: 'ptp/ip' | 'upnp'
    }
}
