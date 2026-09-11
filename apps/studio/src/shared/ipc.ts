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
    Focus: 'camera:focus',
    Capture: 'camera:capture',
    LiveViewStart: 'camera:liveview-start',
    LiveViewStop: 'camera:liveview-stop',
    RecordStart: 'camera:record-start',
    RecordStop: 'camera:record-stop',
    ListFiles: 'camera:list-files',
    DownloadFile: 'camera:download-file',
    DownloadAll: 'camera:download-all',
    KillCameraDaemon: 'system:kill-camera-daemon',
    ChooseDownloadDir: 'system:choose-download-dir',
    RevealPath: 'system:reveal-path',
} as const

export const IPC_EVENTS = {
    State: 'evt:state',
    Log: 'evt:log',
    LiveViewFrame: 'evt:liveview-frame',
    Capture: 'evt:capture',
    FilesProgress: 'evt:files-progress',
} as const

export type IpcResult<T = void> = { ok: true; data: T } | { ok: false; error: string }

export interface CameraSettings {
    iso: string | null
    shutterSpeed: string | null
    aperture: string | null
}

export interface CameraState {
    connected: boolean
    vendor: string | null
    liveView: boolean
    recording: boolean
    settings: CameraSettings
    downloadDir: string
    platform: NodeJS.Platform | string
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
}

export interface CaptureResult {
    filename: string
    savedPath: string
    sizeBytes: number
    /** JPEG bytes for immediate preview; omitted for RAW/oversized captures */
    previewData?: Uint8Array
}

export interface DownloadProgress {
    completed: number
    total: number
    currentFilename: string
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
    focus(): Promise<IpcResult<string>>
    capture(): Promise<IpcResult<CaptureResult>>
    liveViewStart(): Promise<IpcResult<CameraState>>
    liveViewStop(): Promise<IpcResult<CameraState>>
    recordStart(): Promise<IpcResult<CameraState>>
    recordStop(): Promise<IpcResult<CameraState>>
    listFiles(): Promise<IpcResult<FileEntry[]>>
    downloadFile(entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>): Promise<IpcResult<string>>
    downloadAll(): Promise<IpcResult<string[]>>
    killCameraDaemon(): Promise<IpcResult<string>>
    chooseDownloadDir(): Promise<IpcResult<string | null>>
    revealPath(path: string): Promise<IpcResult<void>>
    onState(callback: (state: CameraState) => void): () => void
    onLog(callback: (entry: LogEntry) => void): () => void
    onLiveViewFrame(callback: (jpeg: Uint8Array) => void): () => void
    onCapture(callback: (result: CaptureResult) => void): () => void
    onFilesProgress(callback: (progress: DownloadProgress) => void): () => void
}
