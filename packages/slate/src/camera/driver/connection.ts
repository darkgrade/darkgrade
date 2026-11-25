/**
 * The connection capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * connection slice owns this file and finalizes the result types when the operations land.
 */
export interface CameraInfo {
    manufacturer: string
    model: string
    firmware: string
    lensMount?: string
    connection: 'usb' | 'wifi' | 'ip'
}

export interface ConnectionCapability {
    getInfo(): Promise<CameraInfo>
}
