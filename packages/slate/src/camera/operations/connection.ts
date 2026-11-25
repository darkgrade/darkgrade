import { CanonCamera } from '@camera/canon-camera'
import type { CameraInfo, ConnectOptions, DiscoveredCamera } from '@camera/driver/connection'
import { GenericCamera, type CameraRecoveryOptions, type CameraRecoveryReport } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import {
    cameraContext,
    requireCapability,
    type CameraContext,
    type CameraDriverInstance,
} from '@camera/operations/context'
import { protocolSession } from '@camera/operations/protocol'
import { SonyCamera } from '@camera/sony-camera'
import { VendorExtensionCamera } from '@camera/vendor-extension-camera'
import { Logger } from '@core/logger'
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
    /** @deprecated Use `protocolSession(camera).connectSonyMenuSession()` from `@darkgrade/slate/protocol`. */
    connectSonyMenuSession(device?: DeviceDescriptor): Promise<void>
    /** @deprecated Use `connect({ observeOnly: true })`. */
    connectSonyObservationSession(device?: DeviceDescriptor): Promise<void>
    /**
     * Software-only recovery for a camera that stopped answering: a fresh session, then a PTP
     * Device Reset, then a USB port reset, each proven by GetDeviceInfo. The transport is closed
     * afterwards; call connect() to use the camera. See GenericCamera.recover.
     */
    recover(options?: CameraRecoveryOptions): Promise<CameraRecoveryReport>
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
        const context = cameraContext(this)
        const descriptor = options.device ?? context.deviceDescriptor
        let vendorId = context.options.vendorId ?? descriptorVendor(descriptor)
        if (context.transport instanceof USBTransport) {
            // Select exactly one body first, then its driver. A broad USB filter is not a vendor identity.
            await context.driver.connectTransport(descriptor)
            const identity = context.transport.getDeviceIdentity()
            if (identity) {
                if (context.options.vendorId !== undefined && context.options.vendorId !== identity.vendorId) {
                    await context.transport.disconnect()
                    throw new Error('Selected USB camera differs from the explicitly requested vendor')
                }
                vendorId = identity.vendorId
            }
        }
        if (context.driver.sessionId === null && vendorId !== undefined && context.driver.vendorId !== vendorId) {
            context.driver.detachTransportObserver()
            context.driver = createCameraDriver(context, vendorId)
            for (const subscription of context.subscriptions)
                context.driver.on(subscription.event, subscription.handler as never)
        }
        context.deviceDescriptor = descriptor
        // Preserve the caller-owned partial session for standard protocol diagnostics when
        // vendor initialization is refused. The caller closes it with disconnect() in finally.
        await requireCapability(this, 'connection', 'connect').openSession(descriptor, {
            observeOnly: options.observeOnly === true,
        })
        if (context.options.firstContact !== false) {
            const { recordFirstContact } = await import('@workflows/first-contact')
            await recordFirstContact(this)
        }
    },

    async getInfo(): Promise<CameraInfo> {
        return requireCapability(this, 'connection', 'getInfo').getInfo()
    },

    async connectSonyMenuSession(device?: DeviceDescriptor): Promise<void> {
        return protocolSession(this).connectSonyMenuSession(device)
    },

    async connectSonyObservationSession(device?: DeviceDescriptor): Promise<void> {
        const context = cameraContext(this)
        if (!(context.driver instanceof SonyCamera)) throw new Error('Sony observation sessions require a Sony camera')
        await context.driver.connect(device || context.deviceDescriptor, { configure: false })
    },

    async recover(options?: CameraRecoveryOptions): Promise<CameraRecoveryReport> {
        const context = cameraContext(this)
        return context.driver.recover(context.deviceDescriptor, options)
    },

    async disconnect(): Promise<void> {
        const context = cameraContext(this)
        try {
            await context.driver.disconnect()
        } finally {
            if (context.driver.sessionId === null) context.subscriptions.clear()
        }
    },
}
