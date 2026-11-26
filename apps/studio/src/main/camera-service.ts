import { Camera, runBenchmark, type CameraInfo, type CameraRecordingState } from '@darkgrade/slate'
import {
    CameraRuntime,
    surfaceOperation,
    type CameraProvider,
    type OperationInput,
    type OperationReply,
} from '@darkgrade/slate/runtime'
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
    FilePreview,
    LogEntry,
} from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { app } from 'electron'
import { join } from 'node:path'

/** Studio holds one camera; Slate's runtime queues its work under this identity. */
export const STUDIO_CAMERA = 'studio'

export class CameraService {
    camera: Camera | null = null
    connected = false
    phase: ConnectionPhase = 'idle'
    battery: CameraBattery | null = null
    controls: CameraControls | null = null
    card: CameraCard | null = null
    lens: CameraLens | null = null
    /** Advanced by every zoom release, so a zoom press still waiting in the queue never starts after it. */
    zoomReleases = 0
    clock: CameraClock | null = null
    clockTimer: ReturnType<typeof setInterval> | null = null
    batteryTimer: ReturnType<typeof setInterval> | null = null
    recoveryInProgress = false
    disconnecting = false
    /** Sony property reads leave content-transfer mode, invalidating object handles mid-transfer. */
    storageSessionActive = false
    recording = false
    recordingState: CameraRecordingState = 'idle'
    liveViewRunning = false
    liveViewStopRequested = false
    settings: CameraSettings = { iso: null, shutterSpeed: null, aperture: null }
    downloadDir: string
    broadcast: Broadcast = () => {}

    /**
     * PTP allows one transaction at a time. The window's requests and the camera tools all run
     * through this one runtime, so live-view frames, captures and property reads take turns on the
     * wire, and stopping never waits behind other work.
     */
    readonly runtime: CameraRuntime

    constructor() {
        this.downloadDir = join(app.getPath('pictures'), 'Darkgrade Studio')
        this.runtime = new CameraRuntime(this.provider(), { surface: 'studio' })
    }

    /** Studio as Slate's camera host: the camera it holds, and when an operation may run on it. */
    private provider(): CameraProvider {
        return {
            discover: () => Camera.discover(),
            camera: () => this.requireCamera(),
            assertAllowed: (_camera, operation) => {
                if (surfaceOperation(operation)?.readOnly) this.requireCamera()
                else this.requireCameraForControl()
            },
            benchmark: () => this.benchmarkNow(),
        }
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
            clickToFocus: this.connected && this.focusPointAvailable,
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
    /** Make, model and firmware as Slate reported them on connect. */
    cameraInfo: CameraInfo | null = null

    vendorName(): string | null {
        if (!this.connected) return null
        // Set on every connect: from discovery, or from the driver connect selected for the opened body.
        const vendorId = this.detectedVendorId
        if (vendorId && VENDOR_NAMES[vendorId]) return VENDOR_NAMES[vendorId]
        return this.cameraInfo?.manufacturer ?? this.detectedName ?? 'Generic PTP'
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

    benchmarkRunning = false
    async benchmarkDiagnostics(): Promise<{
        passed: boolean
        checks: Array<{ name: string; passed: boolean; durationMilliseconds: number }>
        path: string
    }> {
        if (!this.camera || this.recording || this.benchmarkRunning)
            throw new Error('Connect an idle camera before benchmarking')
        this.benchmarkRunning = true
        return this.withLiveViewPaused(
            () => this.runtime.benchmark(STUDIO_CAMERA) as ReturnType<CameraService['benchmarkNow']>
        ).finally(() => {
            this.benchmarkRunning = false
        })
    }

    /** The runtime's benchmark hook: runs on its queue, with live view already paused. */
    private async benchmarkNow() {
        if (!this.camera || this.recording) throw new Error('Camera is no longer idle')
        const diagnostics = await import('@darkgrade/slate/telemetry/settings')
        const flush = async () => (await diagnostics.nodeDiagnostics()).flush()
        const result = await runBenchmark(this.camera, { flushEvidence: flush })
        const path = diagnostics.saveDiagnosticProfile(result.profile)
        // runBenchmark flushes after each operation check; the property checks at the end are sent here.
        await flush()
        return { ...result, path }
    }

    /**
     * Window requests run on the runtime's queue. Never call enqueue() from inside an enqueued
     * operation: it waits behind itself.
     */
    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.runtime.runExclusive(STUDIO_CAMERA, operation)
        result.catch(error => {
            if (requiresReconnect(error)) this.scheduleRecovery(error)
        })
        return result
    }

    /** One public Camera operation, as Studio's camera tools call it, through the same runtime. */
    async operation(name: string, input: OperationInput): Promise<OperationReply> {
        try {
            return await this.runtime.operation(STUDIO_CAMERA, name, input)
        } catch (error) {
            // Stopping runs outside the queue and never started a reconnect.
            if (!surfaceOperation(name)?.immediate && requiresReconnect(error)) this.scheduleRecovery(error)
            throw error
        }
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

    /** Slate's last report of whether a focus point can be placed (getCapabilities().operations). */
    focusPointAvailable = false

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

    // ------------------------------------------------------- automatic card list

    filesRefreshTimer: ReturnType<typeof setTimeout> | null = null
    filesRefreshRunning = false

    thumbnailCache = new Map<string, Uint8Array>()

    // ---------------------------------------------------------------- preview

    /** By Slate media id. */
    previewCache = new Map<string, FilePreview>()

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
