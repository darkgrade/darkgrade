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
import {
    createFujifilmRegistry,
    createLeicaRegistry,
    createOlympusRegistry,
    createPanasonicRegistry,
    createSigmaRegistry,
    type VendorOperationRegistry,
} from '@vendors/registry'
import { SonyCamera } from '@vendors/sony/sony-camera'

/** Enumerate USB PTP devices without opening a camera session. */
export async function discoverCameras(): Promise<DiscoveredCamera[]> {
    const transport = new USBTransport(new Logger({ renderInTerminal: false, captureConsole: false }))
    const devices = await transport.discover({ usb: { filters: [{ classCode: 6, subclassCode: 1 }] } })
    return devices.map(({ vendorId, productId, serialNumber, manufacturer, model }) => ({
        vendorId,
        productId,
        serialNumber,
        manufacturer,
        model,
    }))
}

export function descriptorVendor(device?: DeviceDescriptor): number | undefined {
    const vendors = new Set(device?.usb?.filters.map(filter => filter.vendorId))
    return vendors.size === 1 ? [...vendors][0] : undefined
}

/** Vendors with a driver of their own; every other vendor is served by GenericCamera. */
const dedicatedDriverVendors = new Set<number>([
    VendorIDs.SONY,
    VendorIDs.NIKON,
    VendorIDs.CANON,
    VendorIDs.FUJIFILM,
    VendorIDs.PANASONIC,
    VendorIDs.OLYMPUS,
    VendorIDs.OM_DIGITAL,
    VendorIDs.LEICA,
    VendorIDs.SIGMA,
])

/**
 * True when createCameraDriver would build the same kind of driver for this vendor. GenericCamera
 * reports no vendor, so without this a generic body's driver, with its policy and counters, would
 * be discarded and rebuilt on every connect.
 */
export function driverServesVendor(driver: CameraDriverInstance, vendorId: number): boolean {
    if (driver.vendorId === vendorId) return true
    return Object.getPrototypeOf(driver) === GenericCamera.prototype && !dedicatedDriverVendors.has(vendorId)
}

export function createCameraDriver(
    context: Pick<CameraContext, 'transport' | 'logger' | 'options'>,
    vendorId: number | undefined,
    owner: Camera
): CameraDriverInstance {
    const { transport, logger, options } = context
    let driver: CameraDriverInstance
    switch (vendorId) {
        case VendorIDs.SONY:
            driver = new SonyCamera(transport, logger)
            break
        case VendorIDs.NIKON:
            driver = new NikonCamera(transport, logger)
            break
        case VendorIDs.CANON:
            driver = new CanonCamera(transport, logger)
            break
        case VendorIDs.FUJIFILM:
        case VendorIDs.PANASONIC:
        case VendorIDs.OLYMPUS:
        case VendorIDs.OM_DIGITAL:
        case VendorIDs.LEICA:
        case VendorIDs.SIGMA:
            driver = vendorExtensionCamera(context, vendorId)
            break
        default:
            driver = new GenericCamera(transport, logger)
            break
    }
    if (options.transactionPolicy) driver.configureTransactions(options.transactionPolicy)
    if (driver instanceof CanonCamera) driver.setKeepAliveEnabled(options.keepAlive ?? true)
    driver.owner = owner
    return driver
}

function vendorExtensionCamera(
    context: Pick<CameraContext, 'transport' | 'logger'>,
    vendorId: number
): VendorExtensionCamera {
    const littleEndian = context.transport.isLittleEndian()
    const registries: Record<number, () => VendorOperationRegistry> = {
        [VendorIDs.FUJIFILM]: () => createFujifilmRegistry(littleEndian),
        [VendorIDs.PANASONIC]: () => createPanasonicRegistry(littleEndian),
        [VendorIDs.OLYMPUS]: () => createOlympusRegistry(littleEndian),
        [VendorIDs.OM_DIGITAL]: () => createOlympusRegistry(littleEndian),
        [VendorIDs.LEICA]: () => createLeicaRegistry(littleEndian),
        [VendorIDs.SIGMA]: () => createSigmaRegistry(littleEndian),
    }
    return new VendorExtensionCamera(context.transport, context.logger, registries[vendorId](), vendorId)
}
