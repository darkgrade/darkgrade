import { CanonCamera } from '@camera/canon-camera'
import type { CameraInfo, ConnectOptions, DiscoveredCamera, RecoveryReport } from '@camera/driver/connection'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { GenericCamera, type CameraRecoveryOptions } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import {
    cameraContext,
    requireCapability,
    type CameraContext,
    type CameraDriverInstance,
} from '@camera/operations/context'
import { clearNamedEvents, reattachNamedEvents } from '@camera/operations/events'
import { SonyCamera } from '@camera/sony-camera'
import { VendorExtensionCamera } from '@camera/vendor-extension-camera'
import { Logger } from '@core/logger'
import { PTPError, PTPResponseError } from '@core/ptp-errors'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import {
    createFujifilmRegistry,
    createLeicaRegistry,
    createOlympusRegistry,
    createPanasonicRegistry,
    createSigmaRegistry,
    type VendorOperationRegistry,
} from '@ptp/registry'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { USBTransport } from '@transport/usb/usb-transport'

export interface ConnectionOperations {
    /**
     * Opens the camera: selects the attached body, its vendor driver and a session. With
     * `observeOnly`, reads work but no setting is changed (see ConnectOptions).
     */
    connect(options?: ConnectOptions): Promise<void>
    /** What the body reports about itself: make, model, firmware and the connection type. */
    getInfo(): Promise<CameraInfo>
    /**
     * Software-only recovery for a camera that stopped answering: a fresh session, then a PTP
     * Device Reset, then a USB port reset, each proven by GetDeviceInfo. The transport is closed
     * afterwards; call connect() to use the camera. See GenericCamera.recover.
     */
    recover(options?: CameraRecoveryOptions): Promise<RecoveryReport>
    disconnect(): Promise<void>
}

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
function driverServesVendor(driver: CameraDriverInstance, vendorId: number): boolean {
    if (driver.vendorId === vendorId) return true
    return Object.getPrototypeOf(driver) === GenericCamera.prototype && !dedicatedDriverVendors.has(vendorId)
}

export function createCameraDriver(
    context: Pick<CameraContext, 'transport' | 'logger' | 'options'>,
    vendorId?: number
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

/** A descriptor passed where ConnectOptions belong would silently open another body; refuse it. */
function assertConnectOptions(options: ConnectOptions): void {
    if (typeof options !== 'object' || options === null || 'usb' in options || 'ip' in options)
        throw new TypeError('Camera.connect takes { observeOnly?, device? }; pass a device descriptor as { device }')
}

export const connectionOperations: ConnectionOperations & ThisType<Camera> = {
    async connect(options: ConnectOptions = {}): Promise<void> {
        assertConnectOptions(options)
        return withPublicErrors('connect', () => openCamera(this, options))
    },

    async getInfo(): Promise<CameraInfo> {
        return withPublicErrors('getInfo', () => requireCapability(this, 'connection', 'getInfo').getInfo())
    },

    async recover(options?: CameraRecoveryOptions): Promise<RecoveryReport> {
        const context = cameraContext(this)
        return withPublicErrors('recover', () => context.driver.recover(context.deviceDescriptor, options))
    },

    async disconnect(): Promise<void> {
        const context = cameraContext(this)
        try {
            await withPublicErrors('disconnect', () => context.driver.disconnect())
        } finally {
            if (context.driver.sessionId === null) {
                context.subscriptions.clear()
                clearNamedEvents(this)
            }
        }
    },
}

/**
 * Runs a connection operation and reports its failure as one of the three public error types,
 * keeping the driver's error as `cause`: a PTP response the camera refused becomes
 * CameraRefusedError; a timeout, lost transport, unreadable reply, pending recovery or failed
 * cleanup becomes CameraOutcomeUnknownError, since the session's state was not confirmed. Device
 * selection failures before any command (no matching USB device, several matches) and invalid
 * arguments are not camera outcomes and are rethrown unchanged.
 */
async function withPublicErrors<Result>(operation: string, action: () => Promise<Result>): Promise<Result> {
    try {
        return await action()
    } catch (error) {
        throw publicConnectionError(operation, error)
    }
}

function publicConnectionError(operation: string, error: unknown): unknown {
    if (
        error instanceof CameraUnsupportedError ||
        error instanceof CameraRefusedError ||
        error instanceof CameraOutcomeUnknownError
    )
        return error
    if (error instanceof PTPResponseError) return new CameraRefusedError(operation, error.message, { cause: error })
    if (error instanceof PTPError || error instanceof AggregateError)
        return new CameraOutcomeUnknownError(operation, error.message, { cause: error })
    return error
}

async function openCamera(camera: Camera, options: ConnectOptions): Promise<void> {
    const context = cameraContext(camera)
    const descriptor = options.device ?? context.deviceDescriptor
    let vendorId = context.options.vendorId ?? descriptorVendor(descriptor)
    if (context.transport instanceof USBTransport) {
        // Select exactly one body first, then its driver. A broad USB filter is not a vendor identity.
        await context.driver.connectTransport(descriptor)
        const identity = context.transport.getDeviceIdentity()
        if (identity) {
            if (context.options.vendorId !== undefined && context.options.vendorId !== identity.vendorId) {
                await context.transport.disconnect()
                throw new CameraRefusedError('connect', 'Selected USB camera differs from the explicitly requested vendor')
            }
            vendorId = identity.vendorId
        }
    }
    if (context.driver.sessionId === null && vendorId !== undefined && !driverServesVendor(context.driver, vendorId)) {
        context.driver.detachTransportObserver()
        context.driver = createCameraDriver(context, vendorId)
        for (const subscription of context.subscriptions)
            context.driver.on(subscription.event, subscription.handler as never)
        reattachNamedEvents(camera)
    }
    context.deviceDescriptor = descriptor
    // Preserve the caller-owned partial session for standard protocol diagnostics when
    // vendor initialization is refused. The caller closes it with disconnect() in finally.
    await requireCapability(camera, 'connection', 'connect').openSession(descriptor, {
        observeOnly: options.observeOnly === true,
    })
    if (context.options.firstContact !== false) {
        const { recordFirstContact } = await import('@workflows/first-contact')
        await recordFirstContact(camera)
    }
}
