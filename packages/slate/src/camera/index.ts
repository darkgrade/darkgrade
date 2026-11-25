export { readCameraStorages, readCameraObjectHandles, waitForNewCameraMovie } from '@camera/storage'
import type { TransactionPolicy } from '@camera/transaction-channel'
import { Logger } from '@core/logger'
import { LoggerConfig } from '@core/logger-config'
import { CameraOperationQueue } from '@core/operation-queue'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { bodyOperations, type BodyOperations } from '@camera/operations/body'
import {
    connectionOperations,
    createCameraDriver,
    descriptorVendor,
    discoverCameras,
    type ConnectionOperations,
} from '@camera/operations/connection'
import { bindCameraContext, installCameraOperations, type CameraContext } from '@camera/operations/context'
import { eventOperations, type EventOperations } from '@camera/operations/events'
import { focusOperations, type FocusOperations } from '@camera/operations/focus'
import { liveViewOperations, type LiveViewOperations } from '@camera/operations/live-view'
import { mediaOperations, type MediaOperations } from '@camera/operations/media'
import { photoOperations, type PhotoOperations } from '@camera/operations/photo'
import { settingsOperations, type SettingsOperations } from '@camera/operations/settings'
import { videoOperations, type VideoOperations } from '@camera/operations/video'
import { zoomOperations, type ZoomOperations } from '@camera/operations/zoom'
import { installTypedSettings, type TypedSettingMethods } from '@camera/settings/typed-settings'

export interface CameraOptions {
    logger?: Partial<LoggerConfig>
    device?: DeviceDescriptor
    transport?: TransportInterface
    /** A WebUSB implementation for the built-in USB transport to use under Node (see USBTransportOptions.usb). */
    usb?: USB
    /** Timeouts and DeviceBusy retries for every transaction (see DEFAULT_TRANSACTION_POLICY). */
    transactionPolicy?: Partial<TransactionPolicy>
    /** Default true: send the advertised Canon session heartbeat without changing saved body settings. */
    keepAlive?: boolean
    vendorId?: number
    /**
     * Default true: on Node, a body outside Slate's validated list gets one read-only inventory per
     * model+firmware per installation, shared as a `first-contact` profile unless telemetry is off.
     */
    firstContact?: boolean
}

/**
 * One camera, the same on every body that supports an operation. The class holds only
 * construction; each area's methods live in `@camera/operations/<area>` and are installed below,
 * so work on one area never edits another's file. The operation table
 * (`@camera/operations/table`) lists every method with its disposition.
 */
export class Camera {
    /** Enumerate USB PTP devices without opening a camera session. */
    static async discover() {
        return discoverCameras()
    }

    constructor(options: CameraOptions = {}) {
        // Library construction must not replace the host's console or exception handlers.
        const logger = new Logger({ captureConsole: false, renderInTerminal: false, ...options.logger })
        const transport = options.transport ?? new USBTransport(logger, options.usb ? { usb: options.usb } : {})
        const context: CameraContext = {
            options,
            logger,
            transport,
            deviceDescriptor: options.device,
            subscriptions: new Set(),
            controlsQueue: new CameraOperationQueue(),
            driver: createCameraDriver({ options, logger, transport }, options.vendorId ?? descriptorVendor(options.device)),
        }
        bindCameraContext(this, context)
    }
}

export interface Camera
    extends ConnectionOperations,
        SettingsOperations,
        FocusOperations,
        ZoomOperations,
        PhotoOperations,
        LiveViewOperations,
        VideoOperations,
        MediaOperations,
        BodyOperations,
        EventOperations,
        TypedSettingMethods {}

for (const operations of [
    connectionOperations,
    settingsOperations,
    focusOperations,
    zoomOperations,
    photoOperations,
    liveViewOperations,
    videoOperations,
    mediaOperations,
    bodyOperations,
    eventOperations,
])
    installCameraOperations(Camera.prototype, operations)
installTypedSettings(Camera.prototype)

export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@camera/transaction-channel'
export { CanonCamera } from '@camera/canon-camera'
export { GenericCamera } from '@camera/generic-camera'
export { NikonCamera } from '@camera/nikon-camera'
export { SONY_CAMERA_BUTTONS, SonyCamera } from '@camera/sony-camera'
export type { SonyCameraButton, SonyOsdImage, SonyPropertyState, SonyZoomResult } from '@camera/sony-camera'
export { VendorExtensionCamera } from '@camera/vendor-extension-camera'

export { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
export type { SonyKeyboardControls, SonyKeyboardImage } from '@vendors/sony/wifi-keyboard'

export type { NikonFocusResult, NikonFocusPointResult, NikonLiveViewMetadata } from '@camera/nikon-camera'
export { readCameraMovieAudio, inspectMovieTrackHandlers, type CameraMovieAudio } from '@camera/movie-audio'
