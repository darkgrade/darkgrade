import { type CameraContext, type CameraDriverInstance } from '@camera/camera-context'
import type { DiscoveredCamera } from '@camera/driver'
import type { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { CanonCamera } from '@vendors/canon/canon-camera'
import { GenericCamera } from '@vendors/generic/generic-camera'
import { VendorExtensionCamera } from '@vendors/generic/vendor-extension-camera'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { vendorEntry } from '@vendors/vendors'

/** Enumerate USB PTP devices of any vendor without opening a camera session: the bodies connect() can choose from. */
export async function discoverCameras(): Promise<DiscoveredCamera[]> {
    const transport = new USBTransport(new Logger())
    const devices = await transport.listAttached()
    return devices.map(({ vendorId, productId, serialNumber, manufacturer, model }) => ({ vendorId, productId, serialNumber, manufacturer, model }))
}

export function descriptorVendor(device?: DeviceDescriptor): number | undefined {
    const vendors = new Set(device?.usb?.filters.map(filter => filter.vendorId))
    return vendors.size === 1 ? [...vendors][0] : undefined
}

/**
 * True when createCameraDriver would build the same kind of driver for this vendor. GenericCamera
 * reports no vendor, so without this a generic body's driver, with its policy and counters, would
 * be discarded and rebuilt on every connect.
 */
export function driverServesVendor(driver: CameraDriverInstance, vendorId: number): boolean {
    if (driver.vendorId === vendorId) return true
    return Object.getPrototypeOf(driver) === GenericCamera.prototype && !vendorEntry(vendorId)
}

export function createCameraDriver(
    context: Pick<CameraContext, 'transport' | 'logger' | 'options'>,
    vendorId: number | undefined,
    owner: Camera
): CameraDriverInstance {
    const { transport, logger, options } = context
    const vendor = vendorEntry(vendorId)
    const driver: CameraDriverInstance =
        vendorId === VendorIDs.SONY
            ? new SonyCamera(transport, logger)
            : vendorId === VendorIDs.NIKON
              ? new NikonCamera(transport, logger)
              : vendorId === VendorIDs.CANON
                ? new CanonCamera(transport, logger)
                : vendor?.driver === 'extension'
                  ? new VendorExtensionCamera(transport, logger, vendor.registry(transport.isLittleEndian()), vendor.vendorId)
                  : new GenericCamera(transport, logger)
    if (options.transactionPolicy) driver.configureTransactions(options.transactionPolicy)
    if (driver instanceof CanonCamera) driver.setKeepAliveEnabled(options.keepAlive ?? true)
    driver.owner = owner
    return driver
}
