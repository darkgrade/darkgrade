import type { SpeechModelId } from '@shared/speech-models'
import type { DepthModelSize, VisionEngineStatus, VisionModelId, VisionOverlay } from '@shared/vision-models'
/**
 * Shared IPC contract between the Electron main process and the renderer.
 * Every camera capability exposed by @darkgrade/link has a channel here.
 */

export const IPC = {
    DiagnosticsStatus: 'diagnostics:status',
    DiagnosticsBenchmark: 'diagnostics:benchmark',
    DiagnosticsChange: 'diagnostics:change',
    DiagnosticsContact: 'diagnostics:contact',
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
    VoiceGetStatus: 'voice:get-status',
    VisionGetStatus: 'vision:get-status',
    VisionOverlay: 'vision:overlay',
    VoicePrepare: 'voice:prepare',
    VoiceRelease: 'voice:release',
    VoiceSaveSessionAudio: 'voice:save-session-audio',
    PreferencesGet: 'preferences:get',
    PreferencesSet: 'preferences:set',
    McpServerGetStatus: 'mcp:get-status',
    AssistantGetStatus: 'assistant:get-status',
    AssistantProcessTranscript: 'assistant:process-transcript',
    AssistantRelease: 'assistant:release',
    AssistantPrepare: 'assistant:prepare',
    AssistantWarmUp: 'assistant:warm-up',
    ViewReportState: 'view:report-state',
    VoiceDiagnostic: 'voice:diagnostic',
    PerfSampleProcesses: 'perf:sample-processes',
    PerfOpen: 'perf:open',
    PerfReport: 'perf:report',
    PerfIsOpen: 'perf:is-open',
    PerfTrace: 'perf:trace',
} as const

/**
 * Live frames decoded on the GPU by the Metal decoder (Developer Mode) reach a window as textures, not JPEGs. A
 * window says when it can take them, and again if it finds it can't draw them (the main process isn't told when a
 * window's receiver fails), after which it is sent JPEGs.
 */
export const DECODED_FRAMES = {
    Ready: 'decoded-frames:ready',
    Unavailable: 'decoded-frames:unavailable',
    /** Frames in a row that may fail before JPEGs replace them. */
    failuresBeforeJpeg: 3,
} as const

export const IPC_EVENTS = {
    PerfEnabled: 'evt:perf-enabled',
    PerfReport: 'evt:perf-report',
    State: 'evt:state',
    Log: 'evt:log',
    LiveViewFrame: 'evt:liveview-frame',
    FocusFrames: 'evt:focus-frames',
    OsdFrame: 'evt:osd-frame',
    Capture: 'evt:capture',
    FilesProgress: 'evt:files-progress',
    PreviewProgress: 'evt:preview-progress',
    Files: 'evt:files',
    VoiceStatus: 'evt:voice-status',
    VisionStatus: 'evt:vision-status',
    Preferences: 'evt:preferences',
    McpServerStatus: 'evt:mcp-status',
    AssistantStatus: 'evt:assistant-status',
    VoiceIntent: 'evt:voice-intent',
    ViewChange: 'evt:view-change',
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

/** What each setting is called on screen, in logs and in tool descriptions. */
export const CAMERA_CONTROL_LABELS: Record<CameraControlName, string> = {
    whiteBalance: 'White balance',
    colorTemperature: 'Colour temperature',
    imageSize: 'Photo size',
    aspectRatio: 'Aspect ratio',
    jpegQuality: 'JPEG quality',
    movieFrameRate: 'Frame rate',
    zoomMode: 'Zoom mode',
    liveViewQuality: 'Live view quality',
    exposureProgram: 'Shooting mode',
    aperture: 'Aperture',
    shutterSpeed: 'Shutter speed',
    iso: 'ISO',
    focusMode: 'Focus mode',
    focusArea: 'Focus area',
    subjectRecognition: 'Eye tracking',
    recognitionTarget: 'Recognition target',
    eyeSelect: 'Eye',
    stillFormat: 'Photo format',
    movieFormat: 'Movie format',
    movieSetting: 'Movie quality',
}
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
    source: 'camera' | 'system' | 'voice' | 'vision'
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

/** A local model (speech or assistant): its download, startup and the port its server listens on. */
export interface LocalModelStatus {
    phase: 'idle' | 'not-downloaded' | 'downloading' | 'starting' | 'ready' | 'error'
    receivedBytes: number
    totalBytes: number
    port: number | null
    message: string | null
}

/** The part of voice setup under way: Python, its packages, the speech model's download, then loading it. */
export type VoiceSetupStep = 'python' | 'tools' | 'speech-model' | 'loading'

export interface VoiceEngineStatus extends LocalModelStatus {
    setupStep: VoiceSetupStep | null
    /** The chosen speech model's full download size, whatever step setup is on. */
    speechModelBytes: number
}

/** A stretch of live transcript handed to the assistant. Times are milliseconds since the epoch, for the timing log. */
export interface TranscriptSegment {
    segmentId: number
    text: string
    context: string
    /** When its last word arrived from the speech engine. */
    lastWordAtMs: number
    /** When it was handed over (after waiting for the sentence to end). */
    handedOverAtMs: number
}

/** A camera request heard in the live transcript, as the assistant recognises and carries it out. */
export interface VoiceIntent {
    id: number
    /** The transcript stretch it was found in (see assistantProcessTranscript). */
    segmentId: number
    /** The words that made the request, as spoken. */
    quote: string
    instruction: string
    state: 'recognized' | 'running' | 'done' | 'failed'
    /** The assistant's one-line answer once finished. */
    reply: string | null
}

export const SCOPE_IDS = ['histogram', 'waveform', 'vectorscope'] as const
export type ScopeId = (typeof SCOPE_IDS)[number]

/** What Studio's own window shows over and beside the preview: its scopes, zebras and focus peaking. */
export interface StudioViewState {
    scope: ScopeId
    zebras: boolean
    /** Brightness (percent of full scale) at or above which zebra stripes appear, 70–100. */
    zebraLevelPercent: number
    focusPeaking: boolean
    /** 1–100: higher marks softer edges too. */
    peakingSensitivity: number
}

/**
 * EXPERIMENT(usb-transport): what carries the camera's USB connection (Developer Mode › USB Transport). Everything
 * this choice adds is marked EXPERIMENT(usb-transport); src/main/usb-experiments.ts lists the pieces.
 */
export const USB_TRANSPORT_CHOICES = [
    { id: 'node-usb', label: 'Link on node-usb (default)' },
    { id: 'node-usb-rs', label: 'Link on node-usb-rs' },
    { id: 'swift-transport', label: 'Link on a Swift USB transport' },
    { id: 'swift-live-view', label: 'Swift USB transport and Swift live-view loop' },
] as const
export type UsbTransportChoice = (typeof USB_TRANSPORT_CHOICES)[number]['id']

/** Where Developer Mode's live picture comes from: the connected camera, or this Mac's webcam (app menu › Live Feed). */
export const LIVE_FEED_CHOICES = [
    { id: 'camera', label: 'Camera (default)' },
    { id: 'webcam', label: "Webcam (this Mac's camera)" },
] as const
export type LiveFeedChoice = (typeof LIVE_FEED_CHOICES)[number]['id']

/** The webcam replaces the camera's picture only while Developer Mode is on. */
export function usesWebcamFeed(current: Pick<Preferences, 'developerMode' | 'liveFeed'>): boolean {
    return current.developerMode && current.liveFeed === 'webcam'
}

/** Studio's saved settings (Preferences window). */
export interface Preferences {
    /** Serve Studio's camera tools to MCP clients on this Mac. Off by default. */
    mcpServerEnabled: boolean
    mcpServerPort: number
    /** Which Bark model voice uses; switching unloads the old one and loads the new one. */
    speechModel: SpeechModelId
    /** Developer tools in the main window (the Activity log); off by default, toggled from the app menu. */
    developerMode: boolean
    /**
     * Developer Mode's Metal live-view decoder (experimental, macOS): live frames are decoded on the GPU in the main
     * process and drawn by the window's WebGPU as textures. Off: the window decodes each JPEG itself.
     */
    metalLiveViewDecoder: boolean
    /** EXPERIMENT(usb-transport): Developer Mode's USB transport choice; applies from the next connection. */
    usbTransport: UsbTransportChoice
    /**
     * Developer Mode's vision models kept loaded (app menu › Vision Models), each in its own process beside voice and
     * the assistant. Off by default.
     */
    visionModels: VisionModelId[]
    /** Which Depth Pro 2 size runs; switching unloads the old one and loads the new one. */
    depthModelSize: DepthModelSize
    /** Developer Mode's live picture: the camera's live view, or this Mac's webcam in its place. */
    liveFeed: LiveFeedChoice
    /** The macOS material behind the window (View › Window Material); switches live. */
    windowMaterial: WindowMaterial
    /** Let the material go flat while Studio is in the background, as Finder and Messages do; from the next launch. */
    dimWhenInactive: boolean
}

/** The macOS vibrancy materials worth offering, as Electron names them, in the order the menu lists them. */
export const WINDOW_MATERIALS = [
    ['sidebar', 'Sidebar'],
    ['hud', 'HUD'],
    ['under-window', 'Under Window'],
    ['under-page', 'Under Page'],
    ['window', 'Window'],
    ['content', 'Content'],
    ['header', 'Header'],
    ['titlebar', 'Title Bar'],
    ['sheet', 'Sheet'],
    ['popover', 'Popover'],
    ['menu', 'Menu'],
    ['fullscreen-ui', 'Full Screen UI'],
    ['tooltip', 'Tooltip'],
] as const
export type WindowMaterial = (typeof WINDOW_MATERIALS)[number][0]

export interface McpServerStatus {
    running: boolean
    /** Where clients connect, while running. */
    url: string | null
    error: string | null
}

/** API surface exposed on `window.studio` by the preload script. */
/** One of Studio's processes in Developer Mode's performance monitor; 100% CPU is one full core. */
export interface ProcessSample {
    pid: number
    kind:
        | 'main'
        | 'gpu'
        | 'studio'
        | 'settings'
        | 'monitor'
        | 'utility'
        | 'speech'
        | 'assistant'
        | 'windowserver'
        | 'other'
    name: string
    /** What the process does, in a few words. */
    role: string
    /** Not Studio's own: WindowServer, shown because it composites Studio's windows. */
    outside: boolean
    cpuPercent: number
    /** % of the GPU's time, from the time macOS records per process. */
    gpuPercent: number
    memoryMegabytes: number
}

/** What a few seconds of Chromium's trace says each process spent its time on, task by task. */
export interface PerfTrace {
    seconds: number
    /** True where every task had CPU time recorded; otherwise some figures are time spent, waits included. */
    cpuTimed: boolean
    tasks: { process: string; thread: string; task: string; percent: number }[]
}

/** The Studio window's own breakdown, once a second while the monitor window is open. */
export interface PerfReport {
    fps: number
    subsystems: {
        label: string
        detail?: string
        cpuPercent: number
        /** null for work with no GPU passes of its own. */
        gpuPercent: number | null
    }[]
}

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
    voiceGetStatus(): Promise<IpcResult<VoiceEngineStatus>>
    /** Downloads the speech model if needed and starts the engine; resolves with its local port. */
    voicePrepare(): Promise<IpcResult<number>>
    /** Stops the speech engine to free its memory. */
    voiceRelease(): Promise<IpcResult<void>>
    /** Saves the last session's audio as a WAV in Application Support; resolves with its path. */
    voiceSaveSessionAudio(pcm: Uint8Array): Promise<IpcResult<string>>
    /** Adds a line to the speech engine's log file. */
    voiceDiagnostic(message: string): Promise<IpcResult<void>>
    onVoiceStatus(callback: (status: VoiceEngineStatus) => void): () => void
    /** Developer Mode's vision models, each loaded in its own process (app menu › Vision Models). */
    visionGetStatus(): Promise<IpcResult<Record<VisionModelId, VisionEngineStatus>>>
    onVisionStatus(callback: (status: Record<VisionModelId, VisionEngineStatus>) => void): () => void
    /**
     * One overlay of the live picture from a vision model (Developer Mode's scopes): `jpeg` is the frame, or null for
     * the camera's latest live-view frame. `prompt` is what SAM 3 looks for.
     */
    visionOverlay(model: VisionModelId, jpeg: Uint8Array | null, prompt: string): Promise<IpcResult<VisionOverlay>>
    diagnosticsBenchmark(): Promise<
        IpcResult<{
            passed: boolean
            checks: Array<{ name: string; passed: boolean; durationMilliseconds: number }>
            /** Where the profile was saved on this Mac. */
            path: string
        }>
    >
    getDiagnosticsStatus(): Promise<IpcResult<DiagnosticsStatus>>
    changeDiagnostics(action: 'sharing' | 'withdraw' | 'retry', value?: boolean): Promise<IpcResult<DiagnosticsStatus>>
    diagnosticsContact(
        action: 'status' | 'remove' | 'request',
        email?: string,
        name?: string
    ): Promise<IpcResult<DiagnosticsContact | null>>
    getPreferences(): Promise<IpcResult<Preferences>>
    setPreferences(change: Partial<Preferences>): Promise<IpcResult<Preferences>>
    onPreferences(callback: (preferences: Preferences) => void): () => void
    getMcpServerStatus(): Promise<IpcResult<McpServerStatus>>
    /** Every process Studio runs, with the CPU each used since the last call (Developer Mode's monitor). */
    perfSampleProcesses(): Promise<IpcResult<ProcessSample[]>>
    /** Each event channel's count, bytes and handler time since the last call (Developer Mode's monitor). */
    perfTakeIpc(): { channel: string; count: number; milliseconds: number; bytes: number }[]
    /**
     * Live frames the Metal decoder decoded arrive here as GPU textures. Registering tells the main process this
     * window takes them; each frame's VideoFrame is used before the callback resolves.
     */
    onDecodedFrame(callback: (frame: { getVideoFrame(): unknown }) => Promise<void>): void
    /** Records a trace for a few seconds and returns its busiest tasks. */
    perfTrace(seconds: number): Promise<IpcResult<PerfTrace>>
    /** Opens the performance monitor's window. */
    perfOpen(): Promise<IpcResult<void>>
    perfIsOpen(): Promise<IpcResult<boolean>>
    /** The Studio window sends its breakdown here; the monitor window receives it. */
    perfReport(report: PerfReport): Promise<IpcResult<void>>
    onPerfReport(callback: (report: PerfReport) => void): () => void
    /** Whether the monitor window is open, so the Studio window times its subsystems. */
    onPerfEnabled(callback: (enabled: boolean) => void): () => void
    onMcpServerStatus(callback: (status: McpServerStatus) => void): () => void
    assistantGetStatus(): Promise<IpcResult<LocalModelStatus>>
    /** Hands a stretch of live transcript to the assistant to find and carry out camera requests. */
    assistantProcessTranscript(segment: TranscriptSegment): Promise<IpcResult<void>>
    assistantRelease(): Promise<IpcResult<void>>
    /** Downloads the assistant model if needed and starts it. */
    assistantPrepare(): Promise<IpcResult<number>>
    /** The words so far, for the assistant to read ahead while the speaker is still talking. */
    assistantWarmUp(preview: { text: string; context: string }): Promise<IpcResult<void>>
    onAssistantStatus(callback: (status: LocalModelStatus) => void): () => void
    onVoiceIntent(callback: (intent: VoiceIntent) => void): () => void
    /** Tells the main process what the window shows, so tools can read it. */
    reportViewState(state: StudioViewState): Promise<IpcResult<void>>
    /** A tool asked the window to change what it shows. */
    onViewChange(callback: (change: Partial<StudioViewState>) => void): () => void
}

export interface DiagnosticsStatus {
    installationId?: string | null
    sharingEnabled?: boolean
    configured: boolean
    enabled: boolean
    enrolled: boolean
    withdrawalPending: boolean
    queuedEntries: number
    droppedEntries: number
    error: string | null
}
export interface DiagnosticsContact {
    email: string
    verified: true
    credit: { name: string; publish: true } | null
}
