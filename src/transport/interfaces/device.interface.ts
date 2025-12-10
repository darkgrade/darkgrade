export interface DeviceDescriptor {
    usb?: USBDeviceRequestOptions
    ip?: {
        host: string
        port?: number
        protocol?: 'ptp/ip' | 'upnp'
    }
}
