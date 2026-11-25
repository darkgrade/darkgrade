import type {
    CameraCapabilities,
    CameraControlId,
    CameraControlInputs,
    CameraControlState,
    CameraRecordingState,
    OperationAvailability,
} from '@camera/controls'
import type { ExposureContext } from '@camera/exposure-time'
import type { CameraOperationName } from '@camera/operation-table/index'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { CameraRecoveryReport, GenericCamera } from '@vendors/generic/generic-camera'

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

/**
 * - `acquired`: the camera reported focus.
 * - `not-acquired`: the camera reported it could not focus (low contrast, too dark, too close).
 * - `unknown`: the camera focused for a while but reports nothing either way (Canon's timed hold,
 *   Sony in movie mode).
 */
export type FocusResult = 'acquired' | 'not-acquired' | 'unknown'

export type FocusDirection = 'near' | 'far'

/** A small, medium or large manual-focus step, like the < << <<< buttons in vendor remote apps. */
export type FocusStepSize = 'small' | 'medium' | 'large'

export interface FocusPointOptions {
    /** Focus once at the point after moving it (default true). */
    autofocus: boolean
}

export type ZoomDirection = 'in' | 'out'
export type ZoomSpeed = 'slow' | 'medium' | 'fast'

export interface ZoomOptions {
    speed: ZoomSpeed
}

/** The longest a zoom started with startZoom runs before Slate stops it by itself. */
export const ZOOM_SAFETY_STOP_MILLISECONDS = 10_000

/** Where a photo goes: the camera's card, or the card and this computer (its bytes come back). */
export type PhotoDestination = 'card' | 'computer'

export interface TakePhotoOptions {
    /** Default true: focus before the shutter. False releases without waiting for focus. */
    autofocus?: boolean
    /** Default 'card'. With 'computer' the photo is still saved to the card, and its bytes are returned. */
    destination?: PhotoDestination
}

/** A photo confirmed on the card. */
export interface CardPhoto {
    destination: 'card'
    /**
     * The card file's media id, the same id `listMedia()` gives it, for `getMediaPreview()` and
     * `downloadMedia()`. Absent only when the camera offers no card listing over this connection
     * (`listMedia` is unsupported), so no id can name the file.
     */
    mediaId?: string
    /** The file name the camera gave the photo, such as `DSC01234.JPG`. */
    name: string
    /** The size of the card file, as `listMedia()` reports it. */
    sizeBytes: number
}

/**
 * A photo confirmed on the card whose bytes also reached this computer. On Sony the bytes are the
 * copy the camera sends the computer, which is smaller than the card file when the body's PC save
 * size is reduced; `downloadMedia(mediaId)` reads the card file itself.
 */
export interface ComputerPhoto extends Omit<CardPhoto, 'destination'> {
    destination: 'computer'
    data: Uint8Array
}

export type Photo = CardPhoto | ComputerPhoto

/** What a driver confirms for one release: the new card file, and its bytes when asked. */
export interface ConfirmedPhotoFile {
    mediaId?: string
    name: string
    sizeBytes: number
    data?: Uint8Array
}

/** A frame the camera draws over its picture: its focus area, a detected face or a tracked subject. */
export interface FocusFrame {
    kind: 'focus' | 'face' | 'tracking'
    /** True once the camera reports this frame in focus. */
    focused: boolean
    /** Centre and size as fractions of the picture, 0–1 from the top-left. */
    centerX: number
    centerY: number
    width: number
    height: number
}

/** The camera's own on-screen info (menus, dialogs, shooting info), drawn to lay over the picture. */
export interface LiveViewOverlay {
    /** A PNG with transparency, the size of the camera's display. */
    png: Uint8Array
}

export interface LiveViewFrame {
    /** The current picture as a JPEG. */
    jpeg: Uint8Array
    focusFrames: FocusFrame[]
    /** Present when the overlay was requested. */
    overlay?: LiveViewOverlay
}

export interface LiveViewFrameOptions {
    /** Also read the camera's on-screen info. */
    overlay?: boolean
}

/** A finished movie file the camera wrote to its card during one recording. */
export interface Clip {
    /** The card object's id on this connection (its PTP object handle, in decimal). */
    mediaId: string
    /** The file name on the card, such as `C0001.MP4`. */
    name: string
    /** Bytes on the card; absent when the camera reports a size it cannot state (over 4 GiB). */
    sizeBytes?: number
}

/** One card slot as the camera reports it now. A field the camera does not report is absent. */
export interface CardStatus {
    /** 1 for the first slot. */
    slot: number
    /** `ready`: a card is in and readable. `unknown`: the camera did not say. */
    state: 'ready' | 'absent' | 'error' | 'unknown'
    /** Whether the camera says it can record to this card; absent when it does not say. */
    writable?: boolean
    capacityBytes?: number
    freeBytes?: number
    photosRemaining?: number
    recordingSecondsRemaining?: number
}

export type MediaPreviewSize = 'thumbnail' | 'preview'

export interface MediaItem {
    /** Opaque; survives a reconnect while the file stays on the card. */
    id: string
    /** The file name on the card, such as `DSC01234.ARW`. */
    name: string
    kind: 'photo' | 'clip' | 'other'
    slot: number
    sizeBytes?: number
    /** The camera's local wall time, ISO 8601 without an offset (`2026-11-24T14:05:09`). */
    capturedAt?: string
    widthPixels?: number
    heightPixels?: number
    /** The preview sizes `getMediaPreview` can return for this file. */
    previews: readonly MediaPreviewSize[]
}

export interface MediaDownloadOptions {
    /** Called after each chunk with the bytes received so far. */
    onProgress?: (receivedBytes: number, totalBytes: number) => void
    /** Cancels between chunks; the download rejects with the signal's reason. */
    signal?: AbortSignal
}

/** What the camera reports about its power now. A field the camera does not report is absent. */
export interface Battery {
    /** 0–100, when the camera reports a percentage. */
    percent?: number
    /** The camera's coarse level, when it reports one (Canon reports only this). */
    level?: 'empty' | 'low' | 'medium' | 'high' | 'full'
    /** The camera's own estimate for current conditions; never derived from the percentage. */
    minutesRemaining?: number
    /** `unknown` unless the camera says; a USB cable or an outlet is not evidence. */
    powerSource: 'battery' | 'usb' | 'dc' | 'poe' | 'unknown'
    /** Present only when the camera reports it. */
    batteryPresent?: boolean
}

/** `settingsChanged`: a setting changed on the camera. `mediaAdded`: a new photo or clip is on the card. */
export type CameraEventName = 'settingsChanged' | 'mediaAdded'

export type CameraEventHandler = () => void

/**
 * The driver contract: what Camera asks of a vendor driver, so Camera never branches on vendor
 * classes. Every driver has the protocol core (the GenericCamera session it extends). Each
 * operation is an optional method with Camera's own name; a driver that lacks one cannot do it,
 * and Camera reports CameraUnsupportedError. A driver never fakes support it lacks: a method it
 * has but cannot run now says so through `availability`. Camera checks arguments, queues writes
 * and maps nothing vendor-specific; the driver sends each command once and confirms by reading.
 */
export interface DriverOperations {
    /** Opens the PTP session and whatever the vendor's session prepares; observeOnly changes no saved setting. */
    openSession(device: DeviceDescriptor | undefined, options: { observeOnly: boolean }): Promise<void>
    getInfo(): Promise<CameraInfo>
    /** Every setting's value and choices (without `operations`, which Camera adds). */
    getCapabilities(requested?: CameraControlId): Promise<CameraCapabilities>
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
    autofocus(): Promise<FocusResult>
    setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void>
    resetFocusPoint(): Promise<void>
    nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void>
    /** Resolves to the focal length, in millimetres, where the lens landed (read back, never assumed). */
    zoomTo(focalLengthMillimetres: number): Promise<number>
    /** Starts zooming and returns; the driver stops by itself after ZOOM_SAFETY_STOP_MILLISECONDS. */
    startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void>
    /** Always allowed: never waits for another operation and never refused for the camera's mode. */
    stopZoom(): Promise<void>
    /**
     * One shutter release, resolved only once the camera shows the new file. Mode preparation is
     * undone afterwards. Unconfirmed: CameraOutcomeUnknownError, never repeated; refused: CameraRefusedError.
     */
    takePhoto(options: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile>
    getLiveViewFrame(options: { overlay: boolean }): Promise<LiveViewFrame>
    /** What the camera reports now; unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
    /** Prepares, checks the card, sends Record once and resolves once the camera reports recording. */
    startRecording(): Promise<void>
    /** Always allowed. Sends Stop once, confirms idle, finds the new clip, then restores. */
    stopRecording(): Promise<Clip>
    getCardStatus(): Promise<CardStatus[]>
    /** Newest first. */
    listMedia(): Promise<MediaItem[]>
    getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array>
    downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array>
    getBattery(): Promise<Battery>
    /** Sets the clock and resolves once the camera confirms it. */
    setClock(moment: Date): Promise<void>
    /** Calls `handler` for each `settingsChanged` or `mediaAdded`; returns the function that stops it. */
    subscribe(event: CameraEventName, handler: CameraEventHandler): () => void
    /**
     * Whether an operation this driver has can run now, and why not, judged from `capabilities`
     * (the observation just made). Undefined means supported. Sends nothing a getCapabilities
     * would not; a check that throws leaves the operation unreported.
     */
    availability(
        operation: CameraOperationName,
        capabilities: CameraCapabilities
    ): OperationAvailability | undefined | Promise<OperationAvailability | undefined>
    /** Called with each getCapabilities observation, before availability. */
    capabilitiesObserved(capabilities: CameraCapabilities): Promise<void>
    /** Called after each confirmed setControl, so state a driver derived from that setting is dropped. */
    settingWritten(id: CameraControlId): void
}

export type DriverOperationName = keyof DriverOperations

/** The protocol core every driver has: session lifecycle, transactions, properties and events. */
export type DriverCore = Pick<
    GenericCamera,
    'vendorId' | 'sessionId' | 'registry' | 'connect' | 'disconnect' | 'recover' | 'send' | 'get' | 'set' | 'on' | 'off'
>

export interface CameraDriver extends DriverCore, Partial<DriverOperations> {}
