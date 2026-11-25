import type { CameraRecoveryReport } from '@camera/generic-camera'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'

/**
 * The connection capability group of the driver contract (see `@camera/driver/contract`). Every
 * driver opens a PTP session and answers GetDeviceInfo, so every driver provides it; the vendor
 * difference is what opening a session prepares (see `@vendors/capabilities/connection`).
 */

/** How `Camera.connect` opens the camera. */
export interface ConnectOptions {
    /**
     * Read without changing any setting. Slate still opens the vendor's control session (Canon's
     * remote and event modes, Sony's authenticated remote session) because nothing can be read
     * without it, but it writes no host preference: Sony keeps its dial priority and saved image
     * destination. Default false.
     */
    observeOnly?: boolean
    /** The body to open, when it differs from the `device` given to the constructor. */
    device?: DeviceDescriptor
}

/** What the body reports about itself. Fields the body does not report are absent, never guessed. */
export interface CameraInfo {
    /** The make, such as `Sony`. */
    manufacturer: string
    /** As the camera names itself, such as `ILCE-7M5`. */
    model: string
    firmware: string
    /** The body's serial number, when it reports one. */
    serialNumber?: string
    /** Present only for model families whose mount follows from the name (E, A, Z, F, RF). */
    lensMount?: string
    /** `ip` is PTP/IP, over Wi-Fi or Ethernet; `wifi` is a vendor's own Wi-Fi session. */
    connection: 'usb' | 'wifi' | 'ip'
}

/** One attached camera found by `Camera.discover()`, without opening a session. */
export interface DiscoveredCamera {
    vendorId: number
    productId: number
    serialNumber?: string
    /** The USB manufacturer and product strings, as the device reports them. */
    manufacturer?: string
    model?: string
}

/**
 * What `Camera.recover()` did: each software step, whether the camera answered GetDeviceInfo
 * afterwards, and whether only power or hub cycling is left. `CameraRecoveryReport` is the same type.
 */
export type RecoveryReport = CameraRecoveryReport

export interface ConnectionCapability {
    /** Opens the session on the already selected transport and prepares what the vendor needs. */
    openSession(device: DeviceDescriptor | undefined, options: { observeOnly: boolean }): Promise<void>
    /** Reads GetDeviceInfo now. */
    getInfo(): Promise<CameraInfo>
}
