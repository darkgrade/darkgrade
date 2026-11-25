import { Camera, runCameraBenchmark, VendorIDs, type CameraRecordingState } from '@darkgrade/slate'
import { bodyOperations, type BodyOperations } from '@main/camera-service/body'
import { connectionOperations, type ConnectionOperations } from '@main/camera-service/connection'
import { eventsOperations, type EventsOperations } from '@main/camera-service/events'
import { focusOperations, type FocusOperations } from '@main/camera-service/focus'
import { liveViewOperations, type LiveViewOperations } from '@main/camera-service/live-view'
import { mediaOperations, type MediaOperations } from '@main/camera-service/media'
import { photoOperations, type PhotoOperations } from '@main/camera-service/photo'
import { settingsOperations, type SettingsOperations } from '@main/camera-service/settings'
import {
    Broadcast,
    delay,
    errorMessage,
    RECOVERY_RECONNECT_DELAY_MS,
    requiresReconnect,
    VENDOR_NAMES,
} from '@main/camera-service/shared'
import { videoOperations, type VideoOperations } from '@main/camera-service/video'
import { zoomOperations, type ZoomOperations } from '@main/camera-service/zoom'
import { onUsbTransportChanged, swiftLiveViewJpeg } from '@main/usb-experiments'
import type {
    CameraBattery,
    CameraCard,
    CameraClock,
    CameraControlName,
    CameraControls,
    CameraLens,
    CameraSettings,
    CameraState,
    ConnectionPhase,
    FileEntry,
    FilePreview,
    LogEntry,
} from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { app } from 'electron'
import { join } from 'node:path'

export class CameraService {
    camera: Camera | null = null
    connected = false
    phase: ConnectionPhase = 'idle'
    battery: CameraBattery | null = null
    controls: CameraControls | null = null
    card: CameraCard | null = null
    lens: CameraLens | null = null
    clock: CameraClock | null = null
    clockTimer: ReturnType<typeof setInterval> | null = null
    /** Which Sony property each setting was read from on this body. */
    controlProperties = new Map<CameraControlName, string>()
    batteryTimer: ReturnType<typeof setInterval> | null = null
    recoveryInProgress = false
    disconnecting = false
    /** Sony property reads leave content-transfer mode, invalidating object handles mid-transfer. */
    storageSessionActive = false
    recording = false
    recordingState: CameraRecordingState = 'idle'
    recordingMode?: { restore(): Promise<void> }
    recordingStopConfirmed = false
    liveViewRunning = false
    liveViewStopRequested = false
    settings: CameraSettings = { iso: null, shutterSpeed: null, aperture: null }
    downloadDir: string
    broadcast: Broadcast = () => {}

    constructor() {
        this.downloadDir = join(app.getPath('pictures'), 'Darkgrade Studio')
    }

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    // ------------------------------------------------------------------ state

    getState(): CameraState {
        return {
            connected: this.connected,
            phase: this.connected && this.phase === 'idle' ? 'connected' : this.phase,
            vendor: this.vendorName(),
            model: this.connected ? this.detectedModel : null,
            battery: this.battery,
            card: this.card,
            lens: this.connected ? this.lens : null,
            clock: this.connected ? this.clock : null,
            controls: this.controls,
            osdOverlay: this.connected && this.overlaySupported ? this.osdOverlay : null,
            liveView: this.liveViewRunning,
            recording: this.recording,
            recordingState: this.recordingState,
            settings: this.settings,
            downloadDir: this.downloadDir,
            platform: process.platform,
        }
    }

    setDownloadDir(dir: string): void {
        this.downloadDir = dir
        this.broadcastState()
    }

    detectedVendorId: number | null = null
    detectedName: string | null = null
    detectedModel: string | null = null

    vendorName(): string | null {
        if (!this.connected) return null
        const vendorId = this.detectedVendorId ?? this.camera?.getInstance().vendorId
        if (vendorId && VENDOR_NAMES[vendorId]) return VENDOR_NAMES[vendorId]
        return this.detectedName ?? 'Generic PTP'
    }

    broadcastState(): void {
        this.broadcast(IPC_EVENTS.State, this.getState())
    }

    log(source: LogEntry['source'], message: string, level: LogEntry['level'] = 'info'): void {
        const entry: LogEntry = { timestampMs: Date.now(), source, level, message }
        this.broadcast(IPC_EVENTS.Log, entry)
    }

    logSystem(message: string): void {
        this.log('system', message)
    }

    requireCamera(): Camera {
        if (!this.camera || !this.connected) throw new Error('No camera connected')
        return this.camera
    }

    /** Sony drops out of card-transfer mode on any control change, which breaks a transfer in progress. */
    requireCameraForControl(): Camera {
        if (this.storageSessionActive)
            throw new Error('The camera is reading its card. Try again when the transfer finishes.')
        return this.requireCamera()
    }

    // -------------------------------------------------------- operation queue

    /**
     * PTP allows one transaction at a time. Every camera operation funnels
     * through this queue so live-view frames, captures, and property reads
     * can never interleave on the wire. NOTE: never call enqueue() from
     * inside an enqueued operation — that deadlocks.
     */
    benchmarkRunning = false
    async benchmarkDiagnostics(): Promise<{
        passed: boolean
        checks: Array<{ name: string; passed: boolean; durationMilliseconds: number }>
        path: string
    }> {
        if (!this.camera || this.recording || this.benchmarkRunning)
            throw new Error('Connect an idle camera before benchmarking')
        this.benchmarkRunning = true
        return this.withLiveViewPaused(() =>
            this.enqueue(async () => {
                if (!this.camera || this.recording) throw new Error('Camera is no longer idle')
                const diagnostics = await import('@darkgrade/slate/contribute/settings')
                const result = await runCameraBenchmark(this.camera, {
                    flushEvidence: async () => (await diagnostics.nodeDiagnostics()).flush(),
                })
                const path = diagnostics.saveDiagnosticProfile(result.profile)
                await diagnostics.nodeDiagnostics().then(client => client.flush())
                return { ...result, path }
            })
        ).finally(() => {
            this.benchmarkRunning = false
        })
    }

    operationQueue: Promise<unknown> = Promise.resolve()

    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation)
        this.operationQueue = result.catch(() => {})
        result.catch(error => {
            if (requiresReconnect(error)) this.scheduleRecovery(error)
        })
        return result
    }

    /**
     * Slate already reset the USB pipe once if it could. When it reports the session is gone or
     * latched, tear down and reconnect once — the user never has to replug for a stuck transaction.
     */
    scheduleRecovery(cause: unknown): void {
        // A disconnect already in progress is tearing the session down; it must not reconnect.
        if (this.recoveryInProgress || this.disconnecting || !this.connected) return
        this.recoveryInProgress = true
        this.phase = 'recovering'
        this.log('system', `Camera session lost (${errorMessage(cause)}) — reconnecting…`, 'error')
        this.broadcastState()
        void (async () => {
            try {
                await this.disconnect()
                await delay(RECOVERY_RECONNECT_DELAY_MS)
                await this.connect()
                this.log('system', 'Camera session recovered')
            } catch (error) {
                this.log('system', `Recovery failed: ${errorMessage(error)} — replug the camera`, 'error')
            } finally {
                this.recoveryInProgress = false
                if (!this.connected) this.phase = 'idle'
                this.broadcastState()
            }
        })()
    }

    // ------------------------------------------------------------- connection

    connectPromise: Promise<CameraState> | null = null

    settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null
    settingsRefreshDeferred = false

    // ------------------------------------------------------------------ focus

    /** One autofocus cycle via Slate (Sony S1 half-press, Canon/Nikon AF drive). */
    /** The camera's own focus area from before the first click-to-focus, restored by focus(). */
    focusAreaBeforeTouch: string | null = null
    /**
     * Click-to-focus turns Sony's eye tracking (Subject Recognition in AF) off, or the camera pulls
     * focus straight back to a face; focus() turns it back on.
     */
    subjectRecognitionBeforeTouch: string | null = null
    /** The Flexible Spot size last active on the camera, without its Lock on AF prefix. */
    lastFlexibleSpot = 'Flexible Spot M'

    /** Whether the camera's on-screen display is drawn over live view. */
    osdOverlay = false
    /** Whether the camera can send its on-screen display, from its latest capabilities. */
    overlaySupported = false
    lastOsdFrameMs = 0

    /** The camera's focus frames as last sent, so only changes go to the window. */
    focusFramesKey = '[]'

    liveViewLoopDone: Promise<void> | null = null
    /** The newest live-view JPEG, for tools that look at or measure the picture. */
    get latestLiveViewFrame(): Uint8Array | null {
        // EXPERIMENT(usb-transport): the Swift loop keeps its frames to itself until one is asked for.
        return swiftLiveViewJpeg() ?? this.latestNodeFrame
    }
    latestNodeFrame: Uint8Array | null = null

    // ------------------------------------------------------------------ files

    /** Object handles survive Sony's transfer-mode switches, so only new handles need their info read. */
    knownObjects = new Map<number, FileEntry | null>()

    // ------------------------------------------------------- automatic card list

    filesRefreshTimer: ReturnType<typeof setTimeout> | null = null
    filesRefreshRunning = false

    thumbnailCache = new Map<string, Uint8Array>()

    // ---------------------------------------------------------------- preview

    previewCache = new Map<number, FilePreview>()

    /** Reads a card file and returns something viewable: the JPEG, a RAW file's embedded JPEG, or the clip. */
    /** The card read behind the open preview, aborted when the preview closes. */
    previewAbort: AbortController | null = null
}

/**
 * CameraService keeps the state and the shared helpers; each area's methods live in
 * `@main/camera-service/<area>` and are installed here, so work on one area edits one file.
 */
export interface CameraService
    extends
        ConnectionOperations,
        LiveViewOperations,
        EventsOperations,
        SettingsOperations,
        FocusOperations,
        ZoomOperations,
        MediaOperations,
        PhotoOperations,
        VideoOperations,
        BodyOperations {}

for (const operations of [
    connectionOperations,
    liveViewOperations,
    eventsOperations,
    settingsOperations,
    focusOperations,
    zoomOperations,
    mediaOperations,
    photoOperations,
    videoOperations,
    bodyOperations,
])
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(operations)))
        Object.defineProperty(CameraService.prototype, name, { ...descriptor, enumerable: false })

export const cameraService = new CameraService()
// EXPERIMENT(usb-transport): a change of transport takes effect at once.
onUsbTransportChanged(choice => cameraService.reconnectForUsbTransport(choice))
