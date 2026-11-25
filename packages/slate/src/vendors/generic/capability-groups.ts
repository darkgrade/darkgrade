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
    CameraEventHandler,
    CameraEventName,
    CameraInfo,
    CardStatus,
    Clip,
    ConfirmedPhotoFile,
    FocusDirection,
    FocusPointOptions,
    FocusResult,
    FocusStepSize,
    LiveViewFrame,
    MediaDownloadOptions,
    MediaItem,
    MediaPreviewSize,
    PhotoDestination,
    ZoomDirection,
    ZoomOptions,
} from '@camera/driver'
import type { ExposureContext } from '@camera/exposure-time'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'

/*
 * TRANSITIONAL. The capability-group shapes the per-area capability code was written against.
 * Each brand's driver now implements the operations of `@camera/driver` directly and still builds
 * these groups inside; fold each group into the driver's own methods, then delete its type here.
 */

export interface ConnectionCapability {
    /** Opens the session on the already selected transport and prepares what the vendor needs. */
    openSession(device: DeviceDescriptor | undefined, options: { observeOnly: boolean }): Promise<void>
    /** Reads GetDeviceInfo now. */
    getInfo(): Promise<CameraInfo>
}

export interface SettingsCapability {
    /** Fresh observations; `requested` limits the read to one control and its live guards. */
    readCapabilities(requested?: CameraControlId): Promise<CameraCapabilities>
    /** One admitted write, confirmed by polling reads; never replayed. Resolves to the observation. */
    writeControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}

export interface FocusCapability {
    autofocus(): Promise<FocusResult>
    /** 0–1 from the top-left of the picture. */
    setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void>
    /** Back to the centre and to the focus area and subject detection from before the point. Never refused. */
    resetFocusPoint(): Promise<void>
    nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void>
    /** Which focus operations this camera can do now, from an observation it already made (no reads). */
    availability(capabilities: CameraCapabilities): Record<FocusOperationName, OperationAvailability>
    /** A focus setting was written by the application; forget what a focus point had changed about it. */
    settingWritten(id: string): void
    /**
     * The application read the camera's settings (`getCapabilities`). Lets a driver keep what focus
     * needs in place from that observation, without reads of its own: Sony turns on Face/Eye Frame
     * Display once per session while subject detection is on, so live view has face and eye frames.
     */
    capabilitiesObserved?(capabilities: CameraCapabilities): Promise<void>
}

export type FocusOperationName = 'autofocus' | 'setFocusPoint' | 'resetFocusPoint' | 'nudgeFocus'

export interface ZoomCapability {
    /** Resolves to the focal length, in millimetres, where the lens landed (read back, never assumed). */
    zoomTo(focalLengthMillimetres: number): Promise<number>
    /** Starts zooming and returns; the capability stops by itself after ZOOM_SAFETY_STOP_MILLISECONDS. */
    startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void>
    /** Always allowed: never waits for another operation and never refused for the camera's mode. */
    stopZoom(): Promise<void>
    /** Support for each zoom operation from the camera's latest observation; sends nothing. */
    availability(): Record<'zoomTo' | 'startZoom' | 'stopZoom', OperationAvailability>
}

export interface PhotoCapability {
    /**
     * One shutter release, resolved only once the camera shows the new file on its card. Photo or
     * video mode preparation happens inside and is undone afterwards. An unconfirmed release is
     * reported as CameraOutcomeUnknownError and never repeated; a release the camera refuses is
     * CameraRefusedError.
     */
    takePhoto(options: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile>
}

export interface LiveViewCapability {
    getLiveViewFrame(options: { overlay: boolean }): Promise<LiveViewFrame>
    /** Support from the camera's latest observation, including the overlay option; sends nothing. */
    availability(): Record<'getLiveViewFrame', OperationAvailability>
}

export interface VideoCapability {
    /**
     * Prepares the camera (video mode, card destination, audio), checks the card, starts, and
     * resolves once the camera reports recording. A refused start puts the camera back; an
     * unconfirmed one keeps the prepared mode so Stop stays available.
     */
    startRecording(): Promise<void>
    /**
     * Always allowed. Sends Stop once, confirms idle, waits for the new finished clip on the card,
     * then puts the camera back. Called again after a failed restore, it retries only the restore.
     */
    stopRecording(): Promise<Clip>
    /** What the camera reports now; unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
}

export interface MediaCapability {
    getCardStatus(): Promise<CardStatus[]>
    /** Newest first. */
    listMedia(): Promise<MediaItem[]>
    /** A JPEG of a photo or clip. */
    getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array>
    downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array>
    /** Operations this driver has but cannot do right now, with the reason. */
    availability?(): Promise<Partial<Record<MediaOperationName, OperationAvailability>>>
}

export type MediaOperationName = 'getCardStatus' | 'listMedia' | 'getMediaPreview' | 'downloadMedia'

export interface BodyCapability {
    getBattery(): Promise<Battery>
    /** Sets the camera's clock and resolves once the camera confirms it. */
    setClock(moment: Date): Promise<void>
    /** Operations this driver has but cannot do right now, with the reason. */
    availability?(): Promise<Partial<Record<BodyOperationName, OperationAvailability>>>
}

export type BodyOperationName = 'getBattery' | 'setClock'

export interface EventsCapability {
    /** Starts delivering the event to `handler`; returns the function that stops it. */
    subscribe(event: CameraEventName, handler: CameraEventHandler): () => void
}
