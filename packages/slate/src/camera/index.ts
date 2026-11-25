import { bindCameraContext, cameraContext, type CameraContext } from '@camera/camera-context'
import type {
    CameraCapabilities,
    CameraControlId,
    CameraControlInputs,
    CameraControlState,
    CameraRecordingState,
    OperationAvailability,
} from '@camera/controls'
import type {
    Battery,
    CameraDriver,
    CameraEventHandler,
    CameraEventName,
    CameraInfo,
    CardPhoto,
    CardStatus,
    Clip,
    ComputerPhoto,
    ConfirmedPhotoFile,
    ConnectOptions,
    DiscoveredCamera,
    DriverOperationName,
    DriverOperations,
    FocusDirection,
    FocusResult,
    FocusStepSize,
    LiveViewFrame,
    LiveViewFrameOptions,
    MediaDownloadOptions,
    MediaItem,
    MediaPreviewSize,
    Photo,
    RecoveryReport,
    TakePhotoOptions,
    ZoomDirection,
    ZoomOptions,
} from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext } from '@camera/exposure-time'
import { cameraOperationTable, publicOperations, type CameraOperationName } from '@camera/operation-table/index'
import { installTypedSettings, type TypedSettingMethods } from '@camera/settings/typed-settings'
import { Logger } from '@core/logger'
import { LoggerConfig } from '@core/logger-config'
import { CameraOperationQueue } from '@core/operation-queue'
import { PTPError, PTPResponseError } from '@core/ptp-errors'
import type { TransactionPolicy } from '@ptp/transaction-channel'
import type { EventDefinition } from '@ptp/types/event'
import type { EventParams } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { createCameraDriver, descriptorVendor, discoverCameras, driverServesVendor } from '@vendors/drivers'
import type { CameraRecoveryOptions } from '@vendors/generic/generic-camera'
export { readCameraObjectHandles, readCameraStorages, waitForNewCameraMovie } from '@vendors/generic/storage'

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
 * One camera, the same on every body that supports an operation. Camera checks arguments, checks
 * support, queues writes and maps failures to the three public error types; each operation's one
 * implementation is a method of the attached body's driver (the contract in `@camera/driver`).
 */
export class Camera {
    /** Enumerate USB PTP devices without opening a camera session. */
    static async discover(): Promise<DiscoveredCamera[]> {
        return discoverCameras()
    }

    constructor(options: CameraOptions = {}) {
        // Library construction must not replace the host's console or exception handlers.
        const logger = new Logger({ captureConsole: false, renderInTerminal: false, ...options.logger })
        const transport = options.transport ?? new USBTransport(logger, options.usb ? { usb: options.usb } : {})
        const partial = { options, logger, transport }
        const context: CameraContext = {
            ...partial,
            deviceDescriptor: options.device,
            subscriptions: new Set(),
            controlsQueue: new CameraOperationQueue(),
            driver: createCameraDriver(partial, options.vendorId ?? descriptorVendor(options.device), this),
        }
        bindCameraContext(this, context)
    }

    // ------------------------------------------------------------------------------- Connection

    /**
     * Opens the camera: selects the attached body, its vendor driver and a session. With
     * `observeOnly`, reads work but no setting is changed (see ConnectOptions).
     */
    async connect(options: ConnectOptions = {}): Promise<void> {
        if (typeof options !== 'object' || options === null || 'usb' in options || 'ip' in options)
            throw new TypeError(
                'Camera.connect takes { observeOnly?, device? }; pass a device descriptor as { device }'
            )
        return withPublicErrors('connect', () => openCamera(this, options))
    }

    /** What the body reports about itself: make, model, firmware and the connection type. */
    async getInfo(): Promise<CameraInfo> {
        return withPublicErrors('getInfo', () => supported(this, 'getInfo').getInfo())
    }

    /**
     * Software-only recovery for a camera that stopped answering: a fresh session, then a PTP
     * Device Reset, then a USB port reset, each proven by GetDeviceInfo. The transport is closed
     * afterwards; call connect() to use the camera. See GenericCamera.recover.
     */
    async recover(options?: CameraRecoveryOptions): Promise<RecoveryReport> {
        const context = cameraContext(this)
        return withPublicErrors('recover', () => context.driver.recover(context.deviceDescriptor, options))
    }

    async disconnect(): Promise<void> {
        const context = cameraContext(this)
        try {
            await withPublicErrors('disconnect', () => context.driver.disconnect())
        } finally {
            if (context.driver.sessionId === null) {
                context.subscriptions.clear()
                for (const subscription of namedSubscriptionsOf(this).splice(0)) subscription.stop()
            }
        }
    }

    // --------------------------------------------------------------------------------- Settings

    /**
     * Every setting's current value and choices, which operations this camera supports right now
     * (with the reason when not), and the lens and its focal length.
     */
    async getCapabilities(): Promise<CameraCapabilities> {
        const driver = supported(this, 'getCapabilities')
        const capabilities = await driver.getCapabilities()
        await driver.capabilitiesObserved?.(capabilities)
        return { ...capabilities, operations: await readOperationAvailability(driver, capabilities) }
    }

    /**
     * Sets any setting by id, after a fresh read of what the camera offers, and resolves to the
     * value read back. Shutter speed also accepts a duration or angle; cross-unit conversion
     * requires the frame rate in `context`.
     */
    async setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState> {
        const driver = supported(this, 'setControl')
        return onCameraQueue(this, async () => {
            const written = await driver.setControl(id, value, context)
            driver.settingWritten?.(id)
            return written
        })
    }

    // ------------------------------------------------------------------------------------ Focus

    /**
     * Focuses once with the camera's own focus area and says whether the camera confirmed focus:
     * `acquired`, `not-acquired`, or `unknown` when the camera reports nothing either way (Canon's
     * timed hold, Sony in movie mode). Errors: CameraUnsupportedError, CameraRefusedError,
     * CameraOutcomeUnknownError.
     */
    async autofocus(): Promise<FocusResult> {
        const driver = supported(this, 'autofocus')
        return onCameraQueue(this, () => driver.autofocus())
    }

    /**
     * Focuses on a point in the picture, 0–1 from the top-left. Where the focus area has no position
     * (Sony Wide, Zone, Center), Slate switches to a spot; on Sony it also pauses subject detection so
     * eye tracking does not pull focus back to a face. `resetFocusPoint` puts both back. An area
     * chosen with a setter since the point stays. `autofocus: false` only moves the point.
     */
    async setFocusPoint(x: number, y: number, options: { autofocus?: boolean } = {}): Promise<void> {
        const driver = supported(this, 'setFocusPoint')
        const autofocus = options.autofocus ?? true
        return onCameraQueue(this, () => driver.setFocusPoint(x, y, { autofocus }))
    }

    /** Back to the centre and the focus area and subject detection from before. Never refused because of state. */
    async resetFocusPoint(): Promise<void> {
        const driver = supported(this, 'resetFocusPoint')
        return onCameraQueue(this, () => driver.resetFocusPoint())
    }

    /** Moves manual focus a small, medium or large step nearer or farther. */
    async nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void> {
        const driver = supported(this, 'nudgeFocus')
        return onCameraQueue(this, () => driver.nudgeFocus(direction, size))
    }

    // ------------------------------------------------------------------------------------- Zoom

    /**
     * Zooms to a focal length ("go to 35") and resolves to the focal length, in millimetres, where
     * the lens landed, read back from the camera. Needs a power-zoom lens that reports its focal length.
     */
    async zoomTo(focalLengthMillimetres: number): Promise<number> {
        return supported(this, 'zoomTo').zoomTo(focalLengthMillimetres)
    }

    /**
     * Zooms until stopZoom, like holding a zoom rocker, and returns once the camera accepted the
     * command. Slate stops the zoom by itself after 10 seconds.
     */
    async startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void> {
        await supported(this, 'startZoom').startZoom(direction, options)
    }

    /** Stops zooming. Always allowed: it never waits behind another operation, and resolves on a camera without zoom. */
    async stopZoom(): Promise<void> {
        // Nothing can be zooming on a camera without zoom, so stopping succeeds there.
        const driver: CameraDriver = cameraContext(this).driver
        await driver.stopZoom?.()
    }

    // ------------------------------------------------------------------------------------ Photo

    /**
     * Takes one photo and resolves only once the camera shows the new file: its media id, name and
     * size, and for `destination: 'computer'` its bytes. Photo or video mode preparation happens
     * inside and is undone afterwards. The shutter command is never resent: an unconfirmed release
     * is CameraOutcomeUnknownError, a release the camera refuses is CameraRefusedError, and a
     * camera that cannot take one now is CameraUnsupportedError. It is refused while the camera
     * reports a recording, so Stop never waits behind a photo's confirmation.
     */
    takePhoto(options?: TakePhotoOptions & { destination?: 'card' }): Promise<CardPhoto>
    takePhoto(options: TakePhotoOptions & { destination: 'computer' }): Promise<ComputerPhoto>
    takePhoto(options?: TakePhotoOptions): Promise<Photo>
    async takePhoto(options: TakePhotoOptions = {}): Promise<Photo> {
        const autofocus = options.autofocus ?? true
        const destination = options.destination ?? 'card'
        if (typeof autofocus !== 'boolean') throw new CameraRefusedError('takePhoto', 'autofocus must be true or false')
        if (destination !== 'card' && destination !== 'computer')
            throw new CameraRefusedError('takePhoto', "destination must be 'card' or 'computer'")
        const driver = supported(this, 'takePhoto')
        const file = await onCameraQueue(this, async () => {
            await refuseWhileRecording(this)
            return driver.takePhoto({ autofocus, destination })
        })
        return photoFrom(file, destination)
    }

    // -------------------------------------------------------------------------------- Live view

    /**
     * The current picture as a JPEG, with the camera's focus frames (0–1 from the top-left) and,
     * with `overlay`, the camera's on-screen info as a PNG to lay over it. Waits for the camera's
     * next frame first, so calling it in a loop never asks faster than the camera makes frames.
     */
    async getLiveViewFrame(options: LiveViewFrameOptions = {}): Promise<LiveViewFrame> {
        return supported(this, 'getLiveViewFrame').getLiveViewFrame({ overlay: options.overlay === true })
    }

    // ------------------------------------------------------------------------------------ Video

    /** What the camera reports now: `idle`, `starting`, `recording`, `stopping` or `unknown`. Unknown never counts as idle. */
    async getRecordingState(): Promise<CameraRecordingState> {
        return supported(this, 'getRecordingState').getRecordingState()
    }

    /**
     * Gets the camera ready (video mode, card destination), checks the card, starts, and resolves
     * once the camera reports recording. Record is sent once and never repeated. Audio is recorded
     * as `setAudioRecording` (or the camera's own menu) left it; startRecording never changes it.
     */
    async startRecording(): Promise<void> {
        return supported(this, 'startRecording').startRecording()
    }

    /**
     * Stops, waits until a finished clip is on the card, puts the camera back, and resolves to the
     * clip. Always allowed. Throws CameraClipNotFoundError when the camera stopped but no new clip
     * appeared; called again after a failed restore, it retries only the restore.
     */
    async stopRecording(): Promise<Clip> {
        return supported(this, 'stopRecording').stopRecording()
    }

    // ------------------------------------------------------------------------------------ Media

    /** Per card slot: free space, photos left and recording time left, as the camera reports them now. */
    async getCardStatus(): Promise<CardStatus[]> {
        return supported(this, 'getCardStatus').getCardStatus()
    }

    /** Photos and clips on the card, newest first, with ids that survive a reconnect. */
    async listMedia(): Promise<MediaItem[]> {
        return supported(this, 'listMedia').listMedia()
    }

    /** A JPEG of a photo or clip; `item.previews` lists the sizes this camera offers for it. */
    async getMediaPreview(id: string, size: MediaPreviewSize = 'thumbnail'): Promise<Uint8Array> {
        if (size !== 'thumbnail' && size !== 'preview')
            throw new CameraRefusedError(
                'getMediaPreview',
                `Preview size must be thumbnail or preview, not ${String(size)}`
            )
        return supported(this, 'getMediaPreview').getMediaPreview(id, size)
    }

    /** Copies a file off the card, with progress and cancel. Never deletes or changes the card. */
    async downloadMedia(id: string, options: MediaDownloadOptions = {}): Promise<Uint8Array> {
        return supported(this, 'downloadMedia').downloadMedia(id, options)
    }

    // ------------------------------------------------------------------------------------- Body

    /** Level, minutes left, and whether the camera runs on battery, USB or DC power. */
    async getBattery(): Promise<Battery> {
        return supported(this, 'getBattery').getBattery()
    }

    /** Sets the camera's date and time (default: now) and resolves once the camera confirms it. */
    async setClock(moment: Date = new Date()): Promise<void> {
        if (!(moment instanceof Date) || Number.isNaN(moment.getTime()))
            throw new CameraRefusedError('setClock', 'setClock needs a valid Date')
        const driver = supported(this, 'setClock')
        return onCameraQueue(this, () => driver.setClock(moment))
    }

    // ----------------------------------------------------------------------------------- Events

    /** Called when a setting changes on the camera (`settingsChanged`) or a new photo or clip lands (`mediaAdded`). */
    on(event: CameraEventName, handler: CameraEventHandler): void
    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void
    on<E extends EventDefinition>(event: CameraEventName | E, handler: (params: EventParams<E>) => void): void {
        if (isNamedEvent(event)) {
            if (!takesNothing(event, handler)) return
            const stop = supported(this, 'subscribe', 'on').subscribe(event, handler)
            namedSubscriptionsOf(this).push({ event, handler, stop })
            return
        }
        const context = cameraContext(this)
        context.subscriptions.add({ event, handler })
        return context.driver.on(event, handler)
    }

    /** Stops `handler`, or every handler of the event when none is given. */
    off(event: CameraEventName, handler?: CameraEventHandler): void
    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void
    off<E extends EventDefinition>(event: CameraEventName | E, handler?: (params: EventParams<E>) => void): void {
        if (isNamedEvent(event)) {
            const subscriptions = namedSubscriptionsOf(this)
            for (const subscription of [...subscriptions])
                if (subscription.event === event && (!handler || subscription.handler === handler)) {
                    subscription.stop()
                    subscriptions.splice(subscriptions.indexOf(subscription), 1)
                }
            return
        }
        const context = cameraContext(this)
        for (const subscription of context.subscriptions)
            if (subscription.event.name === event.name && (!handler || subscription.handler === handler))
                context.subscriptions.delete(subscription)
        return context.driver.off(event, handler)
    }
}

export interface Camera extends TypedSettingMethods {}
installTypedSettings(Camera.prototype)

type DriverWith<Name extends DriverOperationName> = CameraDriver & Pick<DriverOperations, Name>

function implementsOperation<Name extends DriverOperationName>(
    driver: CameraDriver,
    name: Name
): driver is DriverWith<Name> {
    return typeof driver[name] === 'function'
}

/** The current driver, if it implements `name`; otherwise CameraUnsupportedError naming `operation`. */
function supported<Name extends DriverOperationName>(
    camera: Camera,
    name: Name,
    operation: string = name
): DriverWith<Name> {
    const driver: CameraDriver = cameraContext(camera).driver
    if (!implementsOperation(driver, name))
        throw new CameraUnsupportedError(operation, `${operation} is not supported by this camera`)
    return driver
}

/** Writes and transitions take turns on one queue per camera, so Stop never waits behind a write's confirmation. */
function onCameraQueue<T>(camera: Camera, operation: () => Promise<T>): Promise<T> {
    return cameraContext(camera).controlsQueue.run('camera', operation)
}

/** The operation-table areas whose operations getCapabilities reports. */
const reportedAreas = new Set(['connection', 'focus', 'zoom', 'photo', 'live-view', 'video', 'media', 'body'])
/** Operations every driver has through its protocol core. */
const coreOperations = new Set(['connect', 'disconnect', 'recover'])
const cameraOperationNames = new Set<string>(Object.keys(cameraOperationTable))
const isCameraOperation = (name: string): name is CameraOperationName => cameraOperationNames.has(name)
const isDriverOperation = (name: string): name is DriverOperationName & CameraOperationName => !coreOperations.has(name)

/**
 * `getCapabilities().operations`: for each implemented public operation, whether it can run now
 * and why not. A driver without the method cannot; one whose own check fails leaves that
 * operation unreported, and never fails getCapabilities.
 */
async function readOperationAvailability(
    driver: CameraDriver,
    capabilities: CameraCapabilities
): Promise<Partial<Record<CameraOperationName, OperationAvailability>>> {
    const availability: Partial<Record<CameraOperationName, OperationAvailability>> = {}
    for (const operation of publicOperations()) {
        const name = operation.name
        if (!operation.implemented || !reportedAreas.has(operation.entry.area) || !isCameraOperation(name)) continue
        if (!isDriverOperation(name)) {
            availability[name] = { supported: true }
            continue
        }
        if (typeof driver[name] !== 'function') {
            availability[name] = { supported: false, reason: `${name} is not supported by this camera` }
            continue
        }
        try {
            availability[name] = (await driver.availability?.(name, capabilities)) ?? { supported: true }
        } catch {
            // An operation whose check failed stays unreported.
        }
    }
    return availability
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
        if (
            error instanceof CameraUnsupportedError ||
            error instanceof CameraRefusedError ||
            error instanceof CameraOutcomeUnknownError
        )
            throw error
        if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message, { cause: error })
        if (error instanceof PTPError || error instanceof AggregateError)
            throw new CameraOutcomeUnknownError(operation, error.message, { cause: error })
        throw error
    }
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
                throw new CameraRefusedError(
                    'connect',
                    'Selected USB camera differs from the explicitly requested vendor'
                )
            }
            vendorId = identity.vendorId
        }
    }
    if (context.driver.sessionId === null && vendorId !== undefined && !driverServesVendor(context.driver, vendorId)) {
        context.driver.detachTransportObserver()
        context.driver = createCameraDriver(context, vendorId, camera)
        for (const subscription of context.subscriptions)
            context.driver.on(subscription.event, subscription.handler as never)
        reattachNamedEvents(camera)
    }
    context.deviceDescriptor = descriptor
    // Preserve the caller-owned partial session for standard protocol diagnostics when
    // vendor initialization is refused. The caller closes it with disconnect() in finally.
    await supported(camera, 'openSession', 'connect').openSession(descriptor, {
        observeOnly: options.observeOnly === true,
    })
    if (context.options.firstContact !== false) {
        const { recordFirstContact } = await import('@workflows/first-contact')
        await recordFirstContact(camera)
    }
}

function photoFrom(file: ConfirmedPhotoFile, destination: 'card' | 'computer'): Photo {
    const described = {
        ...(file.mediaId !== undefined && { mediaId: file.mediaId }),
        name: file.name,
        sizeBytes: file.sizeBytes,
    }
    if (destination === 'card') return { destination, ...described }
    if (!file.data)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            'The photo was taken, but its bytes did not reach the computer'
        )
    return { destination, ...described, data: file.data }
}

/**
 * A photo holds the camera's operation queue until its file is confirmed, which on Nikon can take
 * well over a minute after a long exposure. startRecording waits on the same queue, so refusing a
 * photo while a recording is observed means Stop never waits behind one. An unreadable or unknown
 * recording state is not a recording: generic bodies report none.
 */
async function refuseWhileRecording(camera: Camera): Promise<void> {
    const state = await camera.getRecordingState().catch(() => 'unknown' as const)
    if (state === 'recording' || state === 'starting' || state === 'stopping')
        throw new CameraRefusedError(
            'takePhoto',
            `The camera is ${state === 'recording' ? 'recording' : `${state} a recording`}; stop it before taking a photo`
        )
}

interface NamedSubscription {
    event: CameraEventName
    handler: CameraEventHandler
    stop: () => void
}

/** Each Camera's `settingsChanged`/`mediaAdded` listeners, attached to its current driver. */
const namedSubscriptions = new WeakMap<Camera, NamedSubscription[]>()

function namedSubscriptionsOf(camera: Camera): NamedSubscription[] {
    let subscriptions = namedSubscriptions.get(camera)
    if (!subscriptions) {
        subscriptions = []
        namedSubscriptions.set(camera, subscriptions)
    }
    return subscriptions
}

/** Moves every named listener to the driver chosen on connect, as `on(EventDefinition)` listeners move. */
function reattachNamedEvents(camera: Camera): void {
    const subscriptions = namedSubscriptionsOf(camera)
    if (!subscriptions.length) return
    const driver = supported(camera, 'subscribe', 'on')
    for (const subscription of subscriptions) {
        subscription.stop()
        subscription.stop = driver.subscribe(subscription.event, subscription.handler)
    }
}

const isNamedEvent = (event: CameraEventName | EventDefinition): event is CameraEventName => typeof event === 'string'

/** The overloads pair a named event with a handler that takes nothing. */
function takesNothing<Handler extends (params: never) => void>(
    event: CameraEventName | EventDefinition,
    _handler: Handler | CameraEventHandler
): _handler is CameraEventHandler {
    return isNamedEvent(event)
}

export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@ptp/transaction-channel'
export { CanonCamera } from '@vendors/canon/canon-camera'
export { GenericCamera } from '@vendors/generic/generic-camera'
export { VendorExtensionCamera } from '@vendors/generic/vendor-extension-camera'
export { NikonCamera } from '@vendors/nikon/nikon-camera'
export { SONY_CAMERA_BUTTONS, SonyCamera } from '@vendors/sony/sony-camera'
export type { SonyCameraButton, SonyOsdImage, SonyPropertyState, SonyZoomResult } from '@vendors/sony/sony-camera'

export { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
export type { SonyKeyboardControls, SonyKeyboardImage } from '@vendors/sony/wifi-keyboard'

export { inspectMovieTrackHandlers, readCameraMovieAudio, type CameraMovieAudio } from '@camera/movie-audio'
export type { NikonFocusPointResult, NikonFocusResult, NikonLiveViewMetadata } from '@vendors/nikon/nikon-camera'
