/**
 * Shared IPC contract between the Electron main process and the renderer.
 * Every camera capability exposed by @darkgrade/link has a channel here.
 */

export const IPC = {
    Connect: 'camera:connect',
    Disconnect: 'camera:disconnect',
    GetState: 'camera:get-state',
    GetSettings: 'camera:get-settings',
    SetIso: 'camera:set-iso',
    SetShutterSpeed: 'camera:set-shutter-speed',
    SetAperture: 'camera:set-aperture',
    SetControl: 'camera:set-control',
    ZoomStart: 'camera:zoom-start',
    ZoomStop: 'camera:zoom-stop',
    Focus: 'camera:focus',
    FocusAt: 'camera:focus-at',
    SetOsdOverlay: 'camera:set-osd-overlay',
    Capture: 'camera:capture',
    LiveViewStart: 'camera:liveview-start',
    LiveViewStop: 'camera:liveview-stop',
    RecordStart: 'camera:record-start',
    RecordStop: 'camera:record-stop',
    ListFiles: 'camera:list-files',
    DownloadFile: 'camera:download-file',
    DownloadAll: 'camera:download-all',
    Thumbnail: 'camera:thumbnail',
    PreviewFile: 'camera:preview-file',
    CancelPreview: 'camera:cancel-preview',
    KillCameraDaemon: 'system:kill-camera-daemon',
    ChooseDownloadDir: 'system:choose-download-dir',
    RevealPath: 'system:reveal-path',
} as const

export const IPC_EVENTS = {
    State: 'evt:state',
    Log: 'evt:log',
    LiveViewFrame: 'evt:liveview-frame',
    FocusFrames: 'evt:focus-frames',
    OsdFrame: 'evt:osd-frame',
    Capture: 'evt:capture',
    FilesProgress: 'evt:files-progress',
    PreviewProgress: 'evt:preview-progress',
    Files: 'evt:files',
} as const

export type IpcResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export interface CameraSettings {
    iso: string | null
    shutterSpeed: string | null
    aperture: string | null
}

/** A camera setting with the values the body currently allows. */
export interface CameraControl {
    value: string | null
    options: string[]
    /** False while the body disables it (e.g. focus area in manual focus). */
    enabled: boolean
}

export const CAMERA_CONTROL_NAMES = [
    'whiteBalance',
    'colorTemperature',
    'focusMode',
    'focusArea',
    'subjectRecognition',
    'recognitionTarget',
    'eyeSelect',
    'stillFormat',
    'imageSize',
    'aspectRatio',
    'jpegQuality',
    'movieFormat',
    'movieSetting',
    'movieFrameRate',
    'zoomMode',
    'liveViewQuality',
    'exposureProgram',
    'aperture',
    'shutterSpeed',
    'iso',
] as const
export type CameraControlName = (typeof CAMERA_CONTROL_NAMES)[number]
export type CameraControls = Record<CameraControlName, CameraControl | null>

/** The attached lens and where its zoom sits. */
export interface CameraLens {
    name: string | null
    /** Current focal length in millimetres, as the camera reports it. */
    focalLengthMillimetres: number | null
}

/** The camera clock is always set from this computer; this records the last attempt. */
export interface CameraClock {
    /** When Studio last set the camera clock successfully (ms since epoch). */
    syncedAtMs: number | null
    /** Why the last attempt failed, when it did. */
    error: string | null
}

export interface CameraBattery {
    percent: number | null
    level: 'empty' | 'low' | 'medium' | 'high' | 'full' | null
    powerSource: 'battery' | 'dc' | 'usb' | 'poe' | 'unknown'
    /** The camera's own estimate; null when it doesn't report one. */
    remainingMinutes: number | null
}

/** Space left on the card the camera records to. Any field is null when the camera doesn't say. */
export interface CameraCard {
    /**
     * Free space in bytes, when the camera reports it. Sony bodies don't: PTP storage info carries
     * zeros and the Camera Remote SDK has no byte count, only shots and shooting time left.
     */
    freeBytes: number | null
    remainingPhotos: number | null
    remainingVideoSeconds: number | null
}

export type ConnectionPhase = 'idle' | 'connecting' | 'connected' | 'recovering'

export interface CameraState {
    connected: boolean
    phase: ConnectionPhase
    vendor: string | null
    /** Model resolved from the USB identity table, e.g. "ILCE-7M5" → "α7 V" */
    model: string | null
    battery: CameraBattery | null
    card: CameraCard | null
    lens: CameraLens | null
    clock: CameraClock | null
    /** Focus and movie settings; null when the camera doesn't report them (non-Sony for now). */
    controls: CameraControls | null
    /** The camera's on-screen display drawn over live view; null when the camera can't send it. */
    osdOverlay: boolean | null
    liveView: boolean
    recording: boolean
    settings: CameraSettings
    downloadDir: string
    platform: NodeJS.Platform | ''
}

export interface LogEntry {
    timestampMs: number
    source: 'camera' | 'system' | 'voice'
    level: 'info' | 'error'
    message: string
}

export interface FileEntry {
    storageId: number
    storageDescription: string
    objectHandle: number
    filename: string
    sizeBytes: number
    format: string
    captureDate: string
    /** Pixel size of a photo or video, when the camera reports it. */
    width?: number
    height?: number
    /** Sony's content index for this file: thumbnails and screennails come from here. */
    sonyContent?: { contentId: number; fileId: number; slot: 1 | 2 }
}

export type DownloadRequest = Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename' | 'captureDate' | 'sonyContent'>

/** The card list as the main process last read it; files is null while a read is in flight or failed. */
export interface FilesUpdate {
    files: FileEntry[] | null
    updating: boolean
}

export interface FilePreview {
    kind: 'image' | 'video' | 'unsupported'
    mimeType: string
    data: Uint8Array
}

export interface CaptureOptions {
    /** false fires without refocusing (the camera keeps the last focus). Default true. */
    autofocus?: boolean
}

export interface CaptureResult {
    filename: string
    savedPath: string
    sizeBytes: number
    /** JPEG bytes for immediate preview; omitted for RAW/oversized captures */
    previewData?: Uint8Array
}

/** Bytes of the previewed file read from the card so far, and its size. */
export interface PreviewProgress {
    receivedBytes: number
    fileBytes: number
}

/** A frame the camera draws over live view: its focus area, a face or a tracked subject. */
export interface FocusFrame {
    kind: 'focus' | 'face' | 'tracking'
    focused: boolean
    /** Centre and size as fractions of the picture (0–1 from the top left). */
    centerX: number
    centerY: number
    width: number
    height: number
}

export interface DownloadProgress {
    /** Files finished so far, and how many in this download. */
    completed: number
    total: number
    currentFilename: string
    /** Bytes of the current file received so far, and its size. */
    receivedBytes: number
    fileBytes: number
}

/** API surface exposed on `window.studio` by the preload script. */
export interface StudioApi {
    connect(): Promise<IpcResult<CameraState>>
    disconnect(): Promise<IpcResult<CameraState>>
    getState(): Promise<IpcResult<CameraState>>
    getSettings(): Promise<IpcResult<CameraSettings>>
    setIso(value: string): Promise<IpcResult<CameraSettings>>
    setShutterSpeed(value: string): Promise<IpcResult<CameraSettings>>
    setAperture(value: string): Promise<IpcResult<CameraSettings>>
    setControl(name: CameraControlName, value: string): Promise<IpcResult<CameraControls | null>>
    /** Start zooming (optical on power-zoom lenses, Clear Image or digital otherwise) until zoomStop. */
    zoomStart(direction: 'wide' | 'tele'): Promise<IpcResult<void>>
    zoomStop(): Promise<IpcResult<void>>
    focus(): Promise<IpcResult<string>>
    /** Focus on a point of the live view, as fractions of its width and height from the top left. */
    focusAt(x: number, y: number): Promise<IpcResult<string>>
    capture(options?: CaptureOptions): Promise<IpcResult<CaptureResult>>
    liveViewStart(): Promise<IpcResult<CameraState>>
    liveViewStop(): Promise<IpcResult<CameraState>>
    recordStart(): Promise<IpcResult<CameraState>>
    recordStop(): Promise<IpcResult<CameraState>>
    listFiles(): Promise<IpcResult<FileEntry[]>>
    downloadFile(entry: DownloadRequest): Promise<IpcResult<string>>
    downloadAll(): Promise<IpcResult<string[]>>
    previewFile(entry: DownloadRequest): Promise<IpcResult<FilePreview>>
    /** Stops reading the previewed file from the card; the camera goes straight back to shooting. */
    cancelPreview(): Promise<IpcResult<void>>
    /** A small JPEG of a card file (Sony), or null when the camera has none. */
    thumbnail(entry: DownloadRequest): Promise<IpcResult<Uint8Array | null>>
    killCameraDaemon(): Promise<IpcResult<string>>
    chooseDownloadDir(): Promise<IpcResult<string | null>>
    revealPath(path: string): Promise<IpcResult<void>>
    onState(callback: (state: CameraState) => void): () => void
    onLog(callback: (entry: LogEntry) => void): () => void
    onLiveViewFrame(callback: (jpeg: Uint8Array) => void): () => void
    onFocusFrames(callback: (frames: FocusFrame[]) => void): () => void
    /** A PNG of the camera's on-screen display, while the overlay is on. */
    onOsdFrame(callback: (png: Uint8Array) => void): () => void
    setOsdOverlay(enabled: boolean): Promise<IpcResult<CameraState>>
    onCapture(callback: (result: CaptureResult) => void): () => void
    onFilesProgress(callback: (progress: DownloadProgress) => void): () => void
    onPreviewProgress(callback: (progress: PreviewProgress) => void): () => void
    onFiles(callback: (update: FilesUpdate) => void): () => void
}
