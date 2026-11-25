/**
 * The connection capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError.
 */
export interface CameraInfo {
    /** The make, such as `Sony`. */
    manufacturer: string
    /** As the camera names itself, such as `ILCE-7M5`. */
    model: string
    firmware: string
    /** Present only for model families whose mount follows from the name (E, A, Z, F, RF). */
    lensMount?: string
    /** `ip` is PTP/IP, over Wi-Fi or Ethernet; `wifi` is a vendor's own Wi-Fi session. */
    connection: 'usb' | 'wifi' | 'ip'
}

export interface ConnectionCapability {
    getInfo(): Promise<CameraInfo>
}
