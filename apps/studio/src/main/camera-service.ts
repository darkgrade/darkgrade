import {
    Camera,
    runCameraBenchmark,
    identifyCamera,
    isMovableFocusArea,
    PTPDisconnectedError,
    PTPRecoveryRequiredError,
    PTPResponseError,
    PTPTimeoutError,
    readCameraPower,
    VendorIDs,
    type GenericCamera,
    type SonyContent,
    type SonyContentFile,
    type SonyFocalFrame,
    type TransactionPolicy,
} from '@darkgrade/link'
import { killMacCameraDaemons } from '@main/macos-camera-daemon'
import type {
    CameraBattery,
    CameraCard,
    CameraClock,
    CameraControl,
    CameraControlName,
    CameraControls,
    CameraLens,
    CameraSettings,
    CameraState,
    CaptureOptions,
    CaptureResult,
    ConnectionPhase,
    DownloadProgress,
    DownloadRequest,
    FileEntry,
    FilePreview,
    FilesUpdate,
    FocusFrame,
    LogEntry,
    PreviewProgress,
} from '@shared/ipc'
import { CAMERA_CONTROL_LABELS, CAMERA_CONTROL_NAMES, IPC_EVENTS } from '@shared/ipc'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Broadcast = (channel: string, payload: unknown) => void
type DeviceDescriptor = NonNullable<ConstructorParameters<typeof Camera>[0]>['device']

const PREVIEWABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const PREVIEW_MAX_BYTES = 40 * 1024 * 1024
/** Link waits for each new frame itself (Sony makes up to 30 a second), so only yield between frames. */
const LIVE_VIEW_FRAME_DELAY_MS = 0
const LIVE_VIEW_STATISTICS_INTERVAL_MS = 10_000
const LIVE_VIEW_ERROR_DELAY_MS = 500
const LIVE_VIEW_MAX_CONSECUTIVE_ERRORS = 3
const CONNECT_RETRY_DELAY_MS = 400
const DISCOVERY_ATTEMPTS = 5
const DISCOVERY_RETRY_DELAY_MS = 700
const HOTPLUG_CONNECT_DELAY_MS = 1500
const FOCUS_DURATION_MS = 800
const BATTERY_POLL_INTERVAL_MS = 60_000
const RECOVERY_RECONNECT_DELAY_MS = 1200
/**
 * Link resets the USB pipe itself after a timeout or framing fault. A shorter base timeout than
 * Link's 30s default keeps the UI responsive; large transfers still get throughput-scaled time.
 */
const TRANSACTION_POLICY: Partial<TransactionPolicy> = {
    timeoutMilliseconds: 12_000,
    automaticUSBReset: true,
}
const SETTINGS_EVENT_DEBOUNCE_MS = 400
const SET_APPLY_DELAY_MS = 400
const STILL_IMAGE_CLASS = 0x06
const PTP_OK = 0x2001
const DOWNLOAD_PROGRESS_INTERVAL_MS = 100
/** Settings that change what the camera focuses on: changing one refocuses. */
const REFOCUS_CONTROLS = new Set<CameraControlName>([
    'focusArea',
    'subjectRecognition',
    'recognitionTarget',
    'eyeSelect',
])
/** How often the camera's on-screen display is refreshed while it is overlaid. */
const OSD_FRAME_INTERVAL_MS = 250
const CLOCK_SYNC_INTERVAL_MS = 60 * 60 * 1000
/** The longest a held zoom keeps driving before Studio stops it on its own. */
const ZOOM_SAFETY_STOP_MS = 10_000
const KELVIN_MIN = 2500
const KELVIN_MAX = 9900
const KELVIN_STEP = 100
/** Sony property names per setting, newest first: bodies report one or the other. */
const SONY_CONTROL_PROPERTIES: Record<CameraControlName, string[]> = {
    whiteBalance: ['WhiteBalance'],
    colorTemperature: ['ColorTemperature'],
    imageSize: ['SonyImageSize'],
    aspectRatio: ['AspectRatio'],
    jpegQuality: ['JpegQuality'],
    movieFrameRate: ['MovieRecordingFrameRate'],
    zoomMode: ['ZoomSetting'],
    liveViewQuality: ['LiveViewImageQuality'],
    exposureProgram: ['ExposureProgramMode'],
    aperture: ['Aperture', 'FNumber'],
    shutterSpeed: ['ShutterSpeed'],
    iso: ['Iso'],
    focusMode: ['FocusMode'],
    focusArea: ['FocusArea'],
    subjectRecognition: ['SubjectRecognitionInAF'],
    recognitionTarget: ['RecognitionTarget'],
    eyeSelect: ['RightLeftEyeSelect'],
    stillFormat: ['StillFileFormat', 'CompressionSetting'],
    movieFormat: ['MovieFileFormat'],
    movieSetting: ['MovieRecordingSetting'],
}
/** Sony's touch-focus coordinates are on a fixed 640×480 grid regardless of the picture size. */
const SONY_AF_GRID_WIDTH = 640
const SONY_AF_GRID_HEIGHT = 480
const PTP_ACCESS_DENIED = 0x200f
const FILES_REFRESH_DELAY_MS = 1500
const PREVIEW_CACHE_MAX_BYTES = 64 * 1024 * 1024

const VENDOR_NAMES: Record<number, string> = {
    [VendorIDs.SONY]: 'Sony',
    [VendorIDs.NIKON]: 'Nikon',
    [VendorIDs.CANON]: 'Canon',
}

const KNOWN_CAMERA_VENDOR_IDS = new Set<number>([VendorIDs.SONY, VendorIDs.NIKON, VendorIDs.CANON])

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

/** The session is unusable until a fresh disconnect/connect. */
function requiresReconnect(error: unknown): boolean {
    return error instanceof PTPDisconnectedError || error instanceof PTPRecoveryRequiredError
}

/** Sony's colour-temperature range in its own 100 K steps, for bodies that report a range, not a list. */
function kelvinSteps(): string[] {
    const steps: string[] = []
    for (let kelvin = KELVIN_MIN; kelvin <= KELVIN_MAX; kelvin += KELVIN_STEP) steps.push(String(kelvin))
    return steps
}

/** One card file from Sony's content index, shaped like a PTP listing entry (no object handle yet). */
function sonyContentEntry(slot: 1 | 2, content: SonyContent, file: SonyContentFile): FileEntry {
    const filename = file.path.split('/').pop() ?? file.path
    const local = new Date(content.createdLocalMs)
    const pad = (value: number): string => String(value).padStart(2, '0')
    // The camera's local wall time stored as if UTC; format it as PTP's YYYYMMDDThhmmss.
    const captureDate = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}T${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`
    return {
        storageId: slot === 2 ? 0x20001 : 0x10001,
        storageDescription: `Slot ${slot}`,
        objectHandle: -1,
        filename,
        sizeBytes: file.sizeBytes,
        format: file.video ? 'Video' : (filename.split('.').pop()?.toUpperCase() ?? ''),
        captureDate,
        width: file.video?.width ?? file.width,
        height: file.video?.height ?? file.height,
        sonyContent: { contentId: content.contentId, fileId: file.fileId, slot },
    }
}

function describeModel(vendorId: number, productId: number): string | null {
    const identification = identifyCamera({ vendorId, productId })
    if (identification.status === 'unknown') return null
    const [candidate] = identification.candidates
    const model = candidate?.models[0]?.replace(/\s*\(.*\)$/, '')
    if (!model) return null
    return identification.status === 'matched' ? model : `${model} (or similar)`
}

function vendorKind(vendorId: number | null): 'sony' | 'canon' | 'standard' {
    if (vendorId === VendorIDs.SONY) return 'sony'
    if (vendorId === VendorIDs.CANON) return 'canon'
    return 'standard'
}

interface DiscoveredCamera {
    vendorId: number
    productId: number
    name: string
    model: string | null
}

/**
 * Finds the connected camera BEFORE constructing Camera. This matters: the
 * Camera class selects its vendor implementation (SonyCamera / NikonCamera /
 * CanonCamera) from the device descriptor passed to the constructor — with no
 * descriptor every camera falls back to GenericCamera and vendor features
 * (Sony live view, recording, correct property codes) are unavailable.
 */
async function discoverCamera(): Promise<DiscoveredCamera | null> {
    const { webusb } = await import('usb')

    const toDiscovered = (device: USBDevice): DiscoveredCamera => ({
        vendorId: device.vendorId,
        productId: device.productId,
        name: [device.manufacturerName, device.productName].filter(Boolean).join(' ') || 'Unknown camera',
        model: describeModel(device.vendorId, device.productId),
    })

    const isCamera = (device: USBDevice): boolean => {
        if (KNOWN_CAMERA_VENDOR_IDS.has(device.vendorId)) return true
        return (
            device.configuration?.interfaces?.some(usbInterface =>
                usbInterface.alternates?.some(alternate => alternate.interfaceClass === STILL_IMAGE_CLASS)
            ) ?? false
        )
    }

    const devices = await webusb.getDevices().catch(() => [] as USBDevice[])
    const known = devices.find(device => KNOWN_CAMERA_VENDOR_IDS.has(device.vendorId))
    if (known) return toDiscovered(known)
    const anyCamera = devices.find(isCamera)
    if (anyCamera) return toDiscovered(anyCamera)

    // Fallback: explicitly request per known vendor (mirrors link's discover())
    for (const vendorId of KNOWN_CAMERA_VENDOR_IDS) {
        try {
            const device = await webusb.requestDevice({ filters: [{ vendorId, classCode: STILL_IMAGE_CLASS }] })
            if (device) return toDiscovered(device)
        } catch {
            // no device for this vendor
        }
    }
    return null
}

export class CameraService {
    private camera: Camera | null = null
    private connected = false
    private phase: ConnectionPhase = 'idle'
    private battery: CameraBattery | null = null
    private controls: CameraControls | null = null
    private card: CameraCard | null = null
    private lens: CameraLens | null = null
    private clock: CameraClock | null = null
    private clockTimer: ReturnType<typeof setInterval> | null = null
    /** Which Sony property each setting was read from on this body. */
    private controlProperties = new Map<CameraControlName, string>()
    private batteryTimer: ReturnType<typeof setInterval> | null = null
    private recoveryInProgress = false
    /** Sony property reads leave content-transfer mode, invalidating object handles mid-transfer. */
    private storageSessionActive = false
    private recording = false
    private liveViewRunning = false
    private liveViewStopRequested = false
    private settings: CameraSettings = { iso: null, shutterSpeed: null, aperture: null }
    private downloadDir: string
    private broadcast: Broadcast = () => {}

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
            osdOverlay: this.connected && this.detectedVendorId === VendorIDs.SONY ? this.osdOverlay : null,
            liveView: this.liveViewRunning,
            recording: this.recording,
            settings: this.settings,
            downloadDir: this.downloadDir,
            platform: process.platform,
        }
    }

    setDownloadDir(dir: string): void {
        this.downloadDir = dir
        this.broadcastState()
    }

    private detectedVendorId: number | null = null
    private detectedName: string | null = null
    private detectedModel: string | null = null

    private vendorName(): string | null {
        if (!this.connected) return null
        const vendorId = this.detectedVendorId ?? this.camera?.getInstance().vendorId
        if (vendorId && VENDOR_NAMES[vendorId]) return VENDOR_NAMES[vendorId]
        return this.detectedName ?? 'Generic PTP'
    }

    private broadcastState(): void {
        this.broadcast(IPC_EVENTS.State, this.getState())
    }

    private log(source: LogEntry['source'], message: string, level: LogEntry['level'] = 'info'): void {
        const entry: LogEntry = { timestampMs: Date.now(), source, level, message }
        this.broadcast(IPC_EVENTS.Log, entry)
    }

    logSystem(message: string): void {
        this.log('system', message)
    }

    private requireCamera(): Camera {
        if (!this.camera || !this.connected) throw new Error('No camera connected')
        return this.camera
    }

    /** Sony drops out of card-transfer mode on any control change, which breaks a transfer in progress. */
    private requireCameraForControl(): Camera {
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
    private benchmarkRunning = false
    async benchmarkDiagnostics(): Promise<{ passed: boolean; checks: Array<{ name: string; passed: boolean; durationMilliseconds: number }> }> {
        if (!this.camera || this.recording || this.benchmarkRunning) throw new Error('Connect an idle camera before benchmarking')
        this.benchmarkRunning = true
        return this.withLiveViewPaused(() => this.enqueue(async () => {
            if (!this.camera || this.recording) throw new Error('Camera is no longer idle')
            const result = await runCameraBenchmark(this.camera)
            const diagnostics = await import('@darkgrade/contribute/settings')
            diagnostics.saveDiagnosticProfile(result.profile)
            await diagnostics.nodeDiagnostics().then(client => client.flush())
            return result
        })).finally(() => { this.benchmarkRunning = false })
    }

    private operationQueue: Promise<unknown> = Promise.resolve()

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation)
        this.operationQueue = result.catch(() => {})
        result.catch(error => {
            if (requiresReconnect(error)) this.scheduleRecovery(error)
        })
        return result
    }

    /**
     * Link already reset the USB pipe once if it could. When it reports the session is gone or
     * latched, tear down and reconnect once — the user never has to replug for a stuck transaction.
     */
    private scheduleRecovery(cause: unknown): void {
        if (this.recoveryInProgress || !this.connected) return
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

    private connectPromise: Promise<CameraState> | null = null

    /** Serialized: concurrent calls (auto-connect, hotplug, user click) share one attempt. */
    async connect(): Promise<CameraState> {
        if (this.connected) return this.getState()
        if (this.connectPromise) return this.connectPromise
        if (!this.recoveryInProgress) this.phase = 'connecting'
        this.broadcastState()
        this.connectPromise = this.connectInternal(true)
            .catch(error => {
                if (!this.recoveryInProgress) this.phase = 'idle'
                this.broadcastState()
                throw error
            })
            .finally(() => {
                this.connectPromise = null
            })
        return this.connectPromise
    }

    /**
     * Discovery races the macOS camera daemon: while ptpcamerad holds the
     * device, node-usb cannot open it and it is invisible to enumeration.
     * Kill, wait, retry — the 1s killer loop guarantees a clear window.
     */
    private async discoverWithRetry(attempts: number): Promise<DiscoveredCamera | null> {
        for (let attempt = 0; attempt < attempts; attempt++) {
            await killMacCameraDaemons()
            const discovered = await discoverCamera()
            if (discovered) return discovered
            await delay(DISCOVERY_RETRY_DELAY_MS)
        }
        return null
    }

    private async connectInternal(allowVendorUpgrade: boolean): Promise<CameraState> {
        // Discover the device first so Camera instantiates the right vendor
        // implementation (SonyCamera/NikonCamera/CanonCamera) instead of GenericCamera.
        const discovered = await this.discoverWithRetry(DISCOVERY_ATTEMPTS)
        if (discovered) {
            this.detectedVendorId = discovered.vendorId
            this.detectedName = discovered.name
            this.detectedModel = discovered.model
            this.log('system', `Found ${discovered.name} (VID 0x${discovered.vendorId.toString(16).padStart(4, '0')})`)
        } else {
            this.log('system', 'No camera found via USB discovery — trying generic PTP connect', 'error')
        }

        const device: DeviceDescriptor = discovered
            ? { usb: { filters: [{ vendorId: discovered.vendorId, productId: discovered.productId }] } }
            : undefined

        const camera = new Camera({
            logger: { expanded: false, renderInTerminal: false, captureConsole: false },
            device,
            transactionPolicy: TRANSACTION_POLICY,
        })
        try {
            await camera.connect()
        } catch (firstError) {
            // The daemon may have re-claimed the device between kill and claim
            // (launchd respawns it on USB activity). Kill again and retry once.
            this.log(
                'system',
                `First connect attempt failed (${errorMessage(firstError)}), killing daemons and retrying…`
            )
            await killMacCameraDaemons()
            await delay(CONNECT_RETRY_DELAY_MS)
            await camera.connect()
        }

        // If discovery failed and we connected generically, the transport now
        // knows the real vendor. Reconnect with the proper vendor class so
        // live view / recording / vendor properties actually work.
        const revealedVendorId = camera.getInstance().vendorId
        if (!discovered && allowVendorUpgrade && revealedVendorId && KNOWN_CAMERA_VENDOR_IDS.has(revealedVendorId)) {
            this.log(
                'system',
                `Generic probe revealed ${VENDOR_NAMES[revealedVendorId]} camera — reconnecting with vendor support…`
            )
            await camera.disconnect().catch(() => {})
            await delay(CONNECT_RETRY_DELAY_MS)
            return this.connectInternal(false)
        }

        this.camera = camera
        this.connected = true
        this.phase = 'connected'
        this.subscribeToCameraEvents()
        this.startBatteryPolling()
        this.startClockSync()
        this.knownObjects.clear()
        this.previewCache.clear()
        this.scheduleFilesRefresh(FILES_REFRESH_DELAY_MS * 2)
        this.log('system', `Connected to ${this.vendorName()}`)

        // Broadcast connected state immediately — settings reads can be slow
        // (or unsupported) and must never keep the UI stuck on "disconnected".
        this.broadcastState()
        void this.refreshSettings().catch(error =>
            this.log('system', `Settings read failed: ${errorMessage(error)}`, 'error')
        )
        // Live view starts automatically; the loop stops itself if unsupported.
        void this.startLiveView().catch(error =>
            this.log('system', `Live view auto-start failed: ${errorMessage(error)}`, 'error')
        )
        return this.getState()
    }

    // --------------------------------------------------------------- hotplug

    /** Auto-connect when a known camera is plugged in; clean up when unplugged. */
    startAutoDetect(): void {
        void (async () => {
            try {
                const { usb } = await import('usb')
                usb.on('attach', device => {
                    const vendorId = device?.deviceDescriptor?.idVendor
                    if (!vendorId || !KNOWN_CAMERA_VENDOR_IDS.has(vendorId) || this.connected) return
                    this.log('system', `${VENDOR_NAMES[vendorId]} camera plugged in — connecting…`)
                    void delay(HOTPLUG_CONNECT_DELAY_MS)
                        .then(() => this.connect())
                        .catch(error => this.log('system', `Auto-connect failed: ${errorMessage(error)}`, 'error'))
                })
                usb.on('detach', device => {
                    const vendorId = device?.deviceDescriptor?.idVendor
                    if (!this.connected || !vendorId || vendorId !== this.detectedVendorId) return
                    this.log('system', 'Camera unplugged', 'error')
                    void this.disconnect().catch(() => {})
                })
            } catch (error) {
                this.log('system', `USB hotplug watch unavailable: ${errorMessage(error)}`, 'error')
            }
        })()
    }

    async disconnect(): Promise<CameraState> {
        await this.stopLiveView().catch(() => {})
        if (this.recording) await this.stopRecording().catch(() => {})

        if (this.camera) {
            const camera = this.camera
            try {
                await this.enqueue(() => camera.disconnect())
            } catch (error) {
                this.log('system', `Disconnect error: ${errorMessage(error)}`, 'error')
            }
        }

        this.stopBatteryPolling()
        this.camera = null
        this.connected = false
        if (!this.recoveryInProgress) this.phase = 'idle'
        this.recording = false
        this.battery = null
        this.controls = null
        this.card = null
        this.lens = null
        this.clock = null
        if (this.clockTimer) clearInterval(this.clockTimer)
        this.clockTimer = null
        this.detectedVendorId = null
        this.detectedName = null
        this.detectedModel = null
        this.focusAreaBeforeTouch = null
        this.focusFramesKey = '[]'
        this.osdOverlay = false
        this.settings = { iso: null, shutterSpeed: null, aperture: null }
        this.log('system', 'Disconnected')
        this.broadcastState()
        return this.getState()
    }

    /** Turns the camera's on-screen display over live view on or off (Sony). */
    async setOsdOverlay(enabled: boolean): Promise<CameraState> {
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId !== VendorIDs.SONY) throw new Error('Only Sony cameras send their on-screen display')
        this.osdOverlay = enabled
        if (!enabled) await this.enqueue(() => camera.setSonyOsdImageMode(false))
        this.log('system', `Camera display overlay ${enabled ? 'on' : 'off'}`)
        this.broadcastState()
        return this.getState()
    }

    /** Between live-view frames, a fresh on-screen display a few times a second while the overlay is on. */
    private async refreshOsdFrame(camera: Camera): Promise<void> {
        if (!this.osdOverlay || Date.now() - this.lastOsdFrameMs < OSD_FRAME_INTERVAL_MS) return
        this.lastOsdFrameMs = Date.now()
        try {
            const { image } = await this.enqueue(() => camera.captureSonyOsdImage())
            if (this.osdOverlay) this.broadcast(IPC_EVENTS.OsdFrame, image)
        } catch (error) {
            if (requiresReconnect(error)) throw error
        }
    }

    private broadcastFocusFrames(frames: SonyFocalFrame[]): void {
        const focusFrames: FocusFrame[] = frames.map(({ kind, focused, centerX, centerY, width, height }) => ({
            kind,
            focused,
            centerX,
            centerY,
            width,
            height,
        }))
        const key = JSON.stringify(focusFrames)
        if (key === this.focusFramesKey) return
        this.focusFramesKey = key
        this.broadcast(IPC_EVENTS.FocusFrames, focusFrames)
    }

    async dispose(): Promise<void> {
        if (this.connected) await this.disconnect().catch(() => {})
    }

    private subscribeToCameraEvents(): void {
        const camera = this.camera
        if (!camera) return
        const registry = camera.getInstance().registry
        // The camera applies settings asynchronously (and the user can turn physical dials):
        // re-read exposure whenever it reports a property change.
        for (const [name, definition] of Object.entries(registry.events)) {
            const isObjectAdded = /ObjectAdded/i.test(name)
            if (!isObjectAdded && !/DevicePropChanged|PropertyChanged/i.test(name)) continue
            const onEvent = isObjectAdded ? () => this.scheduleFilesRefresh() : () => this.scheduleSettingsRefresh()
            try {
                camera.on(definition as never, onEvent as never)
            } catch {
                // Some vendor registries reject subscriptions for unsupported events
            }
        }
    }

    private settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null
    private settingsRefreshDeferred = false

    /** Debounced camera→UI settings sync, driven by DevicePropChanged events. */
    private scheduleSettingsRefresh(): void {
        if (this.settingsRefreshTimer) clearTimeout(this.settingsRefreshTimer)
        this.settingsRefreshTimer = setTimeout(() => {
            this.settingsRefreshTimer = null
            if (this.storageSessionActive) {
                this.settingsRefreshDeferred = true
                return
            }
            if (this.connected) void this.refreshSettings().catch(() => {})
        }, SETTINGS_EVENT_DEBOUNCE_MS)
    }

    // --------------------------------------------------------------- settings

    /** Runs on the operation queue — never call from inside another enqueued op. */
    private async refreshSettingsRaw(): Promise<CameraSettings> {
        const camera = this.requireCamera()
        // Link bounds every transaction; only a dead session should abort the whole read.
        const readOrNull = async (read: () => Promise<string>): Promise<string | null> => {
            try {
                return await read()
            } catch (error) {
                if (requiresReconnect(error)) throw error
                return null
            }
        }
        this.controls = await this.readControls(camera).catch(error => {
            if (requiresReconnect(error)) throw error
            return this.controls
        })
        this.settings = {
            iso: await readOrNull(() => camera.getIso()),
            shutterSpeed: await readOrNull(() => camera.getShutterSpeed()),
            aperture: await readOrNull(() => camera.getAperture()),
        }
        this.broadcastState()
        return this.settings
    }

    async refreshSettings(): Promise<CameraSettings> {
        return this.enqueue(() => this.refreshSettingsRaw())
    }

    /** Runs on the operation queue. Sony reports every setting with its allowed values in one read. */
    private async readControls(camera: Camera): Promise<CameraControls | null> {
        if (this.detectedVendorId !== VendorIDs.SONY) return null
        const states = await camera.getSonyPropertyStates()
        this.updateCardFromStates(states)
        this.updateLensFromStates(states)
        const pick = (name: CameraControlName): CameraControl | null => {
            const propertyName = SONY_CONTROL_PROPERTIES[name].find(candidate =>
                states.some(state => state.name === candidate)
            )
            if (propertyName) this.controlProperties.set(name, propertyName)
            const state = states.find(candidate => candidate.name === propertyName)
            if (!state) return null
            const value = String(state.value)
            const listed = (state.allowedValues ?? []).map(String)
            const options = name === 'colorTemperature' && listed.length < 2 ? kelvinSteps() : listed
            const enabled = (state as { enabled?: boolean }).enabled !== false
            return { value, options, enabled }
        }
        const controls = Object.fromEntries(CAMERA_CONTROL_NAMES.map(name => [name, pick(name)])) as CameraControls
        await this.showSonyFaceFrames(camera, states, controls.subjectRecognition?.value === 'On')
        const area = controls.focusArea?.value ?? ''
        if (isMovableFocusArea(area)) this.lastFlexibleSpot = area.replace(/^lock on af /i, '')
        return controls
    }

    /**
     * Sony leaves face and eye frames out of live view unless Face/Eye Frame Display is on, so
     * eye tracking would have nothing to follow. Turn it on whenever subject recognition is on.
     * Runs on the operation queue.
     */
    private async showSonyFaceFrames(
        camera: Camera,
        states: Array<{ name: string; value: unknown }>,
        recognitionOn: boolean
    ): Promise<void> {
        const display = states.find(state => state.name === 'FaceEyeFrameDisplay')
        if (!recognitionOn || !display || display.value === 'ON') return
        const properties = camera.getInstance().registry.properties as Record<string, unknown>
        await camera.set(properties.FaceEyeFrameDisplay as never, 'ON' as never).catch(error => {
            if (requiresReconnect(error)) throw error
        })
    }

    /** Sony reports the lens name and the zoom position in thousandths of a millimetre. */
    private updateLensFromStates(states: Array<{ name: string; value: unknown; rawValue: unknown }>): void {
        const name = states.find(state => state.name === 'LensModelName')?.value
        const zoom = Number(states.find(state => state.name === 'ZoomDistance')?.rawValue)
        this.lens = {
            name: typeof name === 'string' && name.trim() ? name.trim() : null,
            focalLengthMillimetres: Number.isFinite(zoom) && zoom > 0 ? zoom / 1000 : null,
        }
    }

    private zoomSafetyTimer: ReturnType<typeof setTimeout> | null = null

    /**
     * Press-and-hold zoom: one quick command to start and one to stop, so live view keeps running
     * while the lens moves. The focal length follows through the camera's property-change events.
     */
    async zoomStart(direction: 'wide' | 'tele'): Promise<void> {
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId !== VendorIDs.SONY) throw new Error('Zoom isn’t available on this camera yet')
        await this.enqueue(() => camera.sonyStartZoom(direction))
        if (this.zoomSafetyTimer) clearTimeout(this.zoomSafetyTimer)
        // Never leave the lens driving if the release is lost (window closed, app crashed).
        this.zoomSafetyTimer = setTimeout(() => void this.zoomStop().catch(() => {}), ZOOM_SAFETY_STOP_MS)
    }

    async zoomStop(): Promise<void> {
        if (this.zoomSafetyTimer) clearTimeout(this.zoomSafetyTimer)
        this.zoomSafetyTimer = null
        const camera = this.camera
        if (!camera || !this.connected || this.detectedVendorId !== VendorIDs.SONY) return
        await this.enqueue(() => camera.sonyStopZoom())
        this.scheduleSettingsRefresh()
    }

    /** Sony reports photos and recording time left on slot 1 among its ordinary properties. */
    private updateCardFromStates(states: Array<{ name: string; rawValue: unknown }>): void {
        const read = (name: string): number | null => {
            const raw = Number(states.find(state => state.name === name)?.rawValue)
            // 0xFFFFFFFF and friends mean "no card" or "not applicable".
            return Number.isFinite(raw) && raw >= 0 && raw < 0xffffff00 ? raw : null
        }
        this.card = {
            freeBytes: this.card?.freeBytes ?? null,
            remainingPhotos: read('MediaSLOT1_RemainingNumber'),
            // Sony reports 0 outside movie mode, which means "not reported", not "full".
            remainingVideoSeconds: read('MediaSLOT1_RemainingTime') || null,
        }
    }

    async setControl(name: CameraControlName, value: string): Promise<CameraControls | null> {
        if (!CAMERA_CONTROL_NAMES.includes(name)) throw new Error(`Unknown setting ${String(name)}`)
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId !== VendorIDs.SONY) throw new Error('This setting isn’t available on this camera yet')
        return this.enqueue(async () => {
            const properties = camera.getInstance().registry.properties as Record<string, unknown>
            const propertyName = this.controlProperties.get(name) ?? SONY_CONTROL_PROPERTIES[name][0]
            const encoded = name === 'colorTemperature' ? Number(value) : value
            await camera.set(properties[propertyName] as never, encoded as never)
            // Choosing an area by hand replaces any switch click-to-focus made.
            if (name === 'focusArea') this.focusAreaBeforeTouch = null
            this.log('system', `${CAMERA_CONTROL_LABELS[name]} → ${value}`)
            // A mode change reshapes what the other settings allow, so those still read back before returning.
            if (name === 'exposureProgram' || name === 'whiteBalance' || name === 'focusMode') {
                await delay(SET_APPLY_DELAY_MS)
                await this.refreshSettingsRaw()
            } else {
                this.applyOptimistically(name, value)
            }
            // A new area or subject setting only takes effect once AF runs again; in PC Remote it doesn't
            // run on its own, so focus once now (e.g. back to Wide finds the eye again).
            if (REFOCUS_CONTROLS.has(name) && !/^(MF|DMF)/i.test(this.controls?.focusMode?.value ?? '')) {
                await camera.autofocus(FOCUS_DURATION_MS)
                this.log('system', 'Refocused')
            }
            return this.controls
        })
    }

    async setIso(value: string): Promise<CameraSettings> {
        await this.enqueue(() => this.requireCameraForControl().setIso(value))
        this.log('system', `ISO → ${value}`)
        return this.applyOptimistically('iso', value)
    }

    async setShutterSpeed(value: string): Promise<CameraSettings> {
        await this.enqueue(() => this.requireCameraForControl().setShutterSpeed(value))
        this.log('system', `Shutter → ${value}`)
        return this.applyOptimistically('shutterSpeed', value)
    }

    async setAperture(value: string): Promise<CameraSettings> {
        await this.enqueue(() => this.requireCameraForControl().setAperture(value))
        this.log('system', `Aperture → ${value}`)
        return this.applyOptimistically('aperture', value)
    }

    /**
     * The camera accepted a value: show it now rather than after a fixed wait and a full re-read
     * (which cost about half a second per change). One re-read follows in the background once
     * changes settle, so anything the camera did differently still shows up.
     */
    private applyOptimistically(name: CameraControlName, value: string): CameraSettings {
        const control = this.controls?.[name]
        if (this.controls && control) this.controls = { ...this.controls, [name]: { ...control, value } }
        if (name === 'iso' || name === 'shutterSpeed' || name === 'aperture')
            this.settings = { ...this.settings, [name]: value }
        this.broadcastState()
        this.scheduleSettingsConfirmation()
        return this.settings
    }

    private settingsConfirmationTimer: ReturnType<typeof setTimeout> | null = null

    private scheduleSettingsConfirmation(): void {
        if (this.settingsConfirmationTimer) clearTimeout(this.settingsConfirmationTimer)
        // Sony applies asynchronously; read back once it has had a moment, after the last of a burst of changes.
        this.settingsConfirmationTimer = setTimeout(() => {
            this.settingsConfirmationTimer = null
            if (this.connected) void this.enqueue(() => this.refreshSettingsRaw()).catch(() => {})
        }, SET_APPLY_DELAY_MS)
    }

    // ------------------------------------------------------------------ focus

    /** One autofocus cycle via Link (Sony S1 half-press, Canon/Nikon AF drive). */
    /** The camera's own focus area from before the first click-to-focus, restored by focus(). */
    private focusAreaBeforeTouch: string | null = null
    /** The Flexible Spot size last active on the camera, without its Lock on AF prefix. */
    private lastFlexibleSpot = 'Flexible Spot M'

    /** Whether the camera's on-screen display is drawn over live view (Sony). */
    private osdOverlay = false
    private lastOsdFrameMs = 0

    /** The camera's focus frames as last sent, so only changes go to the window. */
    private focusFramesKey = '[]'

    private sonyFocusArea(camera: Camera): never {
        return (camera.getInstance().registry.properties as Record<string, unknown>).FocusArea as never
    }

    /**
     * Autofocus with the camera's own focus area. Click-to-focus leaves Sony in a Flexible Spot;
     * this clears that manual point by restoring the area from before (or Wide), then focuses.
     */
    async focus(): Promise<string> {
        const camera = this.requireCameraForControl()
        await this.enqueue(async () => {
            if (this.detectedVendorId === VendorIDs.SONY) await this.clearSonyFocusPoint(camera)
            await camera.autofocus(FOCUS_DURATION_MS)
        })
        this.log('system', 'Autofocus complete')
        return 'Focused'
    }

    /** Runs on the operation queue. */
    private async clearSonyFocusPoint(camera: Camera): Promise<void> {
        // Only undo a switch click-to-focus made: a Zone or Flexible Spot the user chose stays, moved.
        const previous = this.focusAreaBeforeTouch
        this.focusAreaBeforeTouch = null
        if (!previous || isMovableFocusArea(previous)) return
        await camera.set(this.sonyFocusArea(camera), previous as never)
        this.log('system', `Focus area back to ${previous}`)
    }

    /**
     * Click-to-focus: moves the AF point to a spot on the live view (0–1 from the top left) and
     * focuses there. Sony maps it onto its 640×480 AF grid; Nikon takes the fraction directly.
     */
    private flexibleSpotFor(area: string): string {
        return /^lock on af/i.test(area) ? `Lock on AF ${this.lastFlexibleSpot}` : this.lastFlexibleSpot
    }

    async focusAt(x: number, y: number): Promise<string> {
        if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
            throw new Error('Focus point must be inside the picture')
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId === VendorIDs.SONY) {
            const gridX = Math.round(x * (SONY_AF_GRID_WIDTH - 1))
            const gridY = Math.round(y * (SONY_AF_GRID_HEIGHT - 1))
            await this.enqueue(async () => {
                // A Flexible Spot moves as it is. Wide, Zone and Center take no position: switch to the
                // Flexible Spot used last (keeping Lock on AF), and remember the area so Focus restores it.
                const area = String(await camera.get(this.sonyFocusArea(camera)))
                if (!isMovableFocusArea(area)) {
                    this.focusAreaBeforeTouch = area
                    await camera.set(this.sonyFocusArea(camera), this.flexibleSpotFor(area) as never)
                }
                await camera.sonyTouchFocus(gridX, gridY)
            })
        } else if (this.detectedVendorId === VendorIDs.NIKON) {
            await this.enqueue(() => camera.nikonTouchFocus(x, y))
        } else {
            throw new Error('Click to focus isn’t available on this camera yet')
        }
        this.log('system', `Focused at ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`)
        return 'Focused'
    }

    // ---------------------------------------------------------------- capture

    async capture(options: CaptureOptions = {}): Promise<CaptureResult> {
        const camera = this.requireCameraForControl()
        const { info, data } = await this.enqueue(() => camera.captureImage({ autofocus: options.autofocus ?? true }))
        if (!data) throw new Error('Camera returned no image data')

        const filename = info?.filename ?? `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
        const savedPath = await this.saveToDownloadDir(filename, data)
        this.log('system', `Captured ${filename} (${formatBytes(data.byteLength)}) → ${savedPath}`)

        const extension = filename.split('.').pop()?.toLowerCase() ?? ''
        const previewable = PREVIEWABLE_EXTENSIONS.includes(extension) && data.byteLength <= PREVIEW_MAX_BYTES
        const result: CaptureResult = {
            filename,
            savedPath,
            sizeBytes: data.byteLength,
            previewData: previewable ? data : undefined,
        }
        this.broadcast(IPC_EVENTS.Capture, result)
        await this.resumeShooting()
        this.scheduleFilesRefresh()
        return result
    }

    // -------------------------------------------------------------- live view

    async startLiveView(): Promise<CameraState> {
        this.requireCamera()
        if (this.liveViewRunning) return this.getState()

        this.liveViewRunning = true
        this.liveViewStopRequested = false
        this.log('system', 'Live view started')
        this.broadcastState()

        this.liveViewLoopDone = (async () => {
            let consecutiveErrors = 0
            let statisticsStartedMs = performance.now()
            let captureMs = 0
            while (!this.liveViewStopRequested && this.connected && this.camera) {
                const camera = this.camera
                try {
                    // Wait for the next frame outside the command queue, so clicks never wait behind it.
                    const untilNextFrameMs = camera.millisecondsUntilNextLiveViewFrame()
                    if (untilNextFrameMs > 0) await delay(untilNextFrameMs)
                    const captureStartedMs = performance.now()
                    const { data, sonyFocalFrames } = await this.enqueue(() =>
                        camera.captureLiveView({ includeInfo: false })
                    )
                    captureMs += performance.now() - captureStartedMs
                    if (performance.now() - statisticsStartedMs > LIVE_VIEW_STATISTICS_INTERVAL_MS) {
                        const statistics = camera.takeLiveViewStatistics()
                        const seconds = (performance.now() - statisticsStartedMs) / 1000
                        if (statistics?.frames) {
                            console.log(
                                `[live view] ${(statistics.frames / seconds).toFixed(1)} fps, ` +
                                    `${(statistics.requests / statistics.frames).toFixed(2)} requests per frame, ` +
                                    `${(captureMs / statistics.frames).toFixed(1)} ms per capture`
                            )
                        }
                        statisticsStartedMs = performance.now()
                        captureMs = 0
                    }
                    if (data && !this.liveViewStopRequested) {
                        this.latestLiveViewFrame = data
                        this.broadcast(IPC_EVENTS.LiveViewFrame, data)
                        this.broadcastFocusFrames(sonyFocalFrames ?? [])
                        await this.refreshOsdFrame(camera)
                    }
                    consecutiveErrors = 0
                } catch (error) {
                    consecutiveErrors++
                    const message = errorMessage(error)
                    if (requiresReconnect(error)) break
                    // AccessDenied: the body is still in playback/transfer state. Put it back and keep going.
                    if (error instanceof PTPResponseError && error.code === PTP_ACCESS_DENIED) {
                        await this.resumeShooting()
                        await delay(LIVE_VIEW_ERROR_DELAY_MS)
                        continue
                    }
                    if (error instanceof PTPTimeoutError && consecutiveErrors < LIVE_VIEW_MAX_CONSECUTIVE_ERRORS) {
                        await delay(LIVE_VIEW_ERROR_DELAY_MS)
                        continue
                    }
                    if (/not supported/i.test(message)) {
                        this.log('system', `Live view unavailable: ${message}`, 'error')
                        break
                    }
                    if (consecutiveErrors >= LIVE_VIEW_MAX_CONSECUTIVE_ERRORS) {
                        this.log('system', `Live view stopped after repeated errors: ${message}`, 'error')
                        break
                    }
                    this.log('system', `Live view skipped a frame: ${message}`)
                    await delay(LIVE_VIEW_ERROR_DELAY_MS)
                }
                await delay(LIVE_VIEW_FRAME_DELAY_MS)
            }
            this.liveViewRunning = false
            this.broadcastState()
        })()

        return this.getState()
    }

    private liveViewLoopDone: Promise<void> | null = null
    /** The newest live-view JPEG, for tools that look at or measure the picture. */
    latestLiveViewFrame: Uint8Array | null = null

    async stopLiveView(): Promise<CameraState> {
        if (this.liveViewRunning) {
            this.liveViewStopRequested = true
            this.log('system', 'Live view stopped')
        }
        // Wait for the frame loop to actually exit so no live-view operation
        // can interleave with whatever runs next (e.g. storage access).
        if (this.liveViewLoopDone) await this.liveViewLoopDone.catch(() => {})
        this.liveViewRunning = false
        this.broadcastState()
        return this.getState()
    }

    /**
     * Sony storage access (listObjects/getObject) switches the body into
     * "content transfer" mode — a playback-like state — while live view
     * requires shooting mode. Interleaving them makes the camera flip modes
     * per frame and the live view stream shows recorded card images instead
     * of the sensor feed. So: pause live view, do storage work, resume.
     */
    /** Sony can be left showing playback after card access or a shot; re-arm remote shooting. */
    private async resumeShooting(): Promise<void> {
        const camera = this.camera
        if (!camera || !this.connected) return
        try {
            const reopened = await this.enqueue(() => camera.resumeSonyShooting())
            // A new session may number the card's objects differently.
            if (reopened) {
                this.knownObjects.clear()
                this.previewCache.clear()
            }
        } catch (error) {
            this.log('system', `Couldn't return the camera to shooting: ${errorMessage(error)}`, 'error')
        }
    }

    private async withLiveViewPaused<T>(operation: () => Promise<T>): Promise<T> {
        const wasRunning = this.liveViewRunning
        if (wasRunning) await this.stopLiveView()
        this.storageSessionActive = true
        try {
            return await operation()
        } finally {
            await this.resumeShooting()
            this.storageSessionActive = false
            if (this.settingsRefreshDeferred) {
                this.settingsRefreshDeferred = false
                this.scheduleSettingsRefresh()
            }
            if (wasRunning && this.connected) {
                void this.startLiveView().catch(error =>
                    this.log('system', `Live view resume failed: ${errorMessage(error)}`, 'error')
                )
            }
        }
    }

    // -------------------------------------------------------------- recording

    async startRecording(): Promise<CameraState> {
        const camera = this.requireCameraForControl()
        await this.enqueue(() => camera.startRecording())
        this.recording = true
        this.log('system', 'Recording started')
        this.broadcastState()
        return this.getState()
    }

    async stopRecording(): Promise<CameraState> {
        const camera = this.requireCamera()
        await this.enqueue(() => camera.stopRecording())
        this.recording = false
        this.log('system', 'Recording stopped')
        await this.resumeShooting()
        this.scheduleFilesRefresh()
        this.broadcastState()
        return this.getState()
    }

    // ------------------------------------------------------------------ clock

    /** The computer is the source of truth: set the camera clock now and every hour after. */
    private startClockSync(): void {
        if (this.clockTimer) clearInterval(this.clockTimer)
        void this.syncClock()
        this.clockTimer = setInterval(() => void this.syncClock(), CLOCK_SYNC_INTERVAL_MS)
    }

    /** Pushes this computer's time to the camera. Never reads the camera's clock. */
    async syncClock(): Promise<void> {
        const camera = this.camera
        if (!camera || !this.connected || this.detectedVendorId !== VendorIDs.SONY) return
        if (this.storageSessionActive || this.recording) return
        try {
            // Taken inside the queue so the time sent is the time the command runs.
            await this.enqueue(() => camera.setSonyDateTime(new Date()))
            this.clock = { syncedAtMs: Date.now(), error: null }
        } catch (error) {
            if (requiresReconnect(error)) return
            this.clock = { syncedAtMs: this.clock?.syncedAtMs ?? null, error: errorMessage(error) }
            this.log('system', `Couldn't set the camera clock: ${errorMessage(error)}`, 'error')
        }
        this.broadcastState()
    }

    // ---------------------------------------------------------------- battery

    private startBatteryPolling(): void {
        this.stopBatteryPolling()
        void this.refreshBattery()
        this.batteryTimer = setInterval(() => void this.refreshBattery(), BATTERY_POLL_INTERVAL_MS)
    }

    private stopBatteryPolling(): void {
        if (this.batteryTimer) clearInterval(this.batteryTimer)
        this.batteryTimer = null
    }

    private async refreshBattery(): Promise<void> {
        const camera = this.camera
        if (!camera || !this.connected || this.storageSessionActive) return
        try {
            const power = await this.enqueue(() =>
                readCameraPower(camera as Parameters<typeof readCameraPower>[0], vendorKind(this.detectedVendorId))
            )
            this.battery = power
                ? {
                      percent: power.percent ?? null,
                      level: power.level ?? null,
                      powerSource: power.powerSource,
                      remainingMinutes: power.remainingMinutes ?? null,
                  }
                : null
            this.broadcastState()
        } catch {
            // Battery telemetry is best-effort; a dead session is handled by enqueue's recovery.
        }
    }

    // ------------------------------------------------------------------ files

    /** Object handles survive Sony's transfer-mode switches, so only new handles need their info read. */
    private knownObjects = new Map<number, FileEntry | null>()

    private async listFilesInner(): Promise<FileEntry[]> {
        const instance = this.requireCamera().getInstance() as GenericCamera & {
            prepareStorageRead?: () => Promise<void>
        }
        const operations = instance.registry.operations
        return this.enqueue(async () => {
            await instance.prepareStorageRead?.()
            const storageIds = await instance.send(operations.GetStorageIDs, {})
            if (storageIds.code !== PTP_OK || !Array.isArray(storageIds.data)) throw new Error('The camera has no card')
            const seen = new Set<number>()
            const entries: FileEntry[] = []
            let freeBytes: number | null = null
            for (const storageId of storageIds.data) {
                if ((storageId & 0xffff) === 0) continue
                if (freeBytes === null) {
                    const storage = await instance.send(operations.GetStorageInfo, { StorageID: storageId })
                    // Sony reports capacity and free space as 0 over PTP; only trust a real capacity.
                    if (storage.code === PTP_OK && storage.data && Number(storage.data.maxCapacity) > 0)
                        freeBytes = Number(storage.data.freeSpaceInBytes)
                }
                const handles = await instance.send(operations.GetObjectHandles, { StorageID: storageId })
                if (handles.code !== PTP_OK || !Array.isArray(handles.data)) continue
                for (const objectHandle of handles.data) {
                    seen.add(objectHandle)
                    if (!this.knownObjects.has(objectHandle)) {
                        this.knownObjects.set(
                            objectHandle,
                            await this.readObjectEntry(instance, storageId, objectHandle)
                        )
                    }
                    const entry = this.knownObjects.get(objectHandle)
                    if (entry) entries.push(entry)
                }
            }
            for (const objectHandle of this.knownObjects.keys()) {
                if (!seen.has(objectHandle)) this.knownObjects.delete(objectHandle)
            }
            if (freeBytes !== null) {
                this.card = { remainingPhotos: null, remainingVideoSeconds: null, ...this.card, freeBytes }
                this.broadcastState()
            }
            return entries
        })
    }

    /** Folders (PTP associations) come back as null: they have no bytes to show or download. */
    private async readObjectEntry(
        instance: GenericCamera,
        storageId: number,
        objectHandle: number
    ): Promise<FileEntry | null> {
        const response = await instance.send(instance.registry.operations.GetObjectInfo, { ObjectHandle: objectHandle })
        if (response.code !== PTP_OK || !response.data) return null
        const info = response.data
        if (Number(info.associationType ?? 0) !== 0 || /association/i.test(String(info.objectFormatDecoded ?? '')))
            return null
        return {
            storageId,
            storageDescription: '',
            objectHandle,
            filename: String(info.filename ?? `object-${objectHandle}`),
            sizeBytes: Number(info.objectCompressedSize ?? 0),
            format: String(info.objectFormatDecoded ?? info.objectFormat ?? ''),
            captureDate: String(info.captureDate ?? ''),
        }
    }

    // ------------------------------------------------------- automatic card list

    private filesRefreshTimer: ReturnType<typeof setTimeout> | null = null
    private filesRefreshRunning = false

    /** Keeps the renderer's card list current without the user asking: debounced, never while recording. */
    private scheduleFilesRefresh(delayMs = FILES_REFRESH_DELAY_MS): void {
        if (this.filesRefreshTimer) clearTimeout(this.filesRefreshTimer)
        this.filesRefreshTimer = setTimeout(() => {
            this.filesRefreshTimer = null
            void this.refreshFilesNow()
        }, delayMs)
    }

    private async refreshFilesNow(): Promise<void> {
        if (!this.connected || this.recording || this.storageSessionActive || this.filesRefreshRunning) {
            if (this.connected && !this.recording) this.scheduleFilesRefresh()
            return
        }
        this.filesRefreshRunning = true
        this.broadcast(IPC_EVENTS.Files, { files: null, updating: true } satisfies FilesUpdate)
        try {
            const files = await this.readCardList()
            this.broadcast(IPC_EVENTS.Files, { files, updating: false } satisfies FilesUpdate)
        } catch (error) {
            this.broadcast(IPC_EVENTS.Files, { files: null, updating: false } satisfies FilesUpdate)
            this.log('system', `Couldn't read the card: ${errorMessage(error)}`, 'error')
        } finally {
            this.filesRefreshRunning = false
        }
    }

    /** On demand (voice): read the card now and push the result like an automatic refresh. */
    async listFiles(): Promise<FileEntry[]> {
        const files = await this.readCardList()
        this.broadcast(IPC_EVENTS.Files, { files, updating: false } satisfies FilesUpdate)
        return files
    }

    /**
     * Sony indexes the card itself (Remote Control with Transfer Mode): reading that index needs no
     * content-transfer mode, so live view keeps running. Other cameras list objects over PTP.
     */
    private async readCardList(): Promise<FileEntry[]> {
        const camera = this.camera
        if (camera && this.detectedVendorId === VendorIDs.SONY) {
            return this.enqueue(async () => {
                const list = await camera.listSonyContents({ slot: 1 })
                return list.contents.flatMap(content =>
                    content.files.map(file => sonyContentEntry(list.slot === 2 ? 2 : 1, content, file))
                )
            })
        }
        return this.withLiveViewPaused(() => this.listFilesInner())
    }

    private thumbnailCache = new Map<string, Uint8Array>()

    async thumbnail(entry: DownloadRequest): Promise<Uint8Array | null> {
        const content = entry.sonyContent
        const camera = this.camera
        if (!content || !camera || !this.connected) return null
        const key = `${content.slot}:${content.contentId}:${content.fileId}`
        const cached = this.thumbnailCache.get(key)
        if (cached) return cached
        const jpeg = await this.enqueue(() =>
            camera.getSonyContentPreview(content.contentId, content.fileId, { slot: content.slot, size: 'thumbnail' })
        )
        this.thumbnailCache.set(key, jpeg)
        return jpeg
    }

    // ---------------------------------------------------------------- preview

    private previewCache = new Map<number, FilePreview>()

    /** Reads a card file and returns something viewable: the JPEG, a RAW file's embedded JPEG, or the clip. */
    /** The card read behind the open preview, aborted when the preview closes. */
    private previewAbort: AbortController | null = null

    cancelPreview(): void {
        this.previewAbort?.abort()
        this.previewAbort = null
    }

    async previewFile(entry: DownloadRequest): Promise<FilePreview> {
        const camera = this.requireCameraForControl()
        // Sony serves a large JPEG of any photo straight from its index: no card read, no RAW download.
        const content = entry.sonyContent
        if (content && !VIDEO_MIME_TYPES[entry.filename.split('.').pop()?.toLowerCase() ?? '']) {
            const jpeg = await this.enqueue(() =>
                camera.getSonyContentPreview(content.contentId, content.fileId, {
                    slot: content.slot,
                    size: 'screennail',
                })
            )
            return { kind: 'image', mimeType: 'image/jpeg', data: jpeg }
        }
        const fileHandle = await this.resolveObjectHandle(entry)
        const cached = this.previewCache.get(fileHandle)
        if (cached) return cached
        // Sony only serves objects whose handles were fetched in the current transfer session.
        const data = await this.withLiveViewPaused(async () => {
            await this.listFilesInner()
            let lastReportMs = 0
            this.previewAbort?.abort()
            const abort = new AbortController()
            this.previewAbort = abort
            abort.signal.throwIfAborted()
            return this.enqueue(() =>
                camera.getObject(
                    fileHandle,
                    entry.sizeBytes,
                    receivedBytes => {
                        const now = Date.now()
                        if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                        lastReportMs = now
                        this.broadcast(IPC_EVENTS.PreviewProgress, {
                            receivedBytes,
                            fileBytes: entry.sizeBytes,
                        } satisfies PreviewProgress)
                    },
                    abort.signal
                )
            )
        })
        const preview = buildPreview(entry.filename, data)
        if (data.byteLength <= PREVIEW_CACHE_MAX_BYTES) this.previewCache.set(fileHandle, preview)
        return preview
    }

    /** Sony index entries carry no PTP handle; find the card object by name and size when one is needed. */
    private async resolveObjectHandle(entry: DownloadRequest): Promise<number> {
        if (entry.objectHandle >= 0) return entry.objectHandle
        const objects = await this.withLiveViewPaused(() => this.listFilesInner())
        const match = objects.find(object => object.filename === entry.filename && object.sizeBytes === entry.sizeBytes)
        if (!match) throw new Error(`${entry.filename} is no longer on the card`)
        return match.objectHandle
    }

    private async downloadFileInner(
        entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>,
        position: { index: number; count: number } = { index: 0, count: 1 }
    ): Promise<string> {
        const camera = this.requireCamera()
        const report = (receivedBytes: number): void =>
            this.broadcast(IPC_EVENTS.FilesProgress, {
                completed: position.index,
                total: position.count,
                currentFilename: entry.filename,
                receivedBytes,
                fileBytes: entry.sizeBytes,
            } satisfies DownloadProgress)
        report(0)
        let lastReportMs = 0
        const data = await this.enqueue(() =>
            camera.getObject(entry.objectHandle, entry.sizeBytes, receivedBytes => {
                const now = Date.now()
                if (now - lastReportMs < DOWNLOAD_PROGRESS_INTERVAL_MS) return
                lastReportMs = now
                report(receivedBytes)
            })
        )
        if (position.count === 1) this.finishDownloadProgress(1)
        const savedPath = await this.saveToDownloadDir(entry.filename, data)
        this.log('system', `Downloaded ${entry.filename} → ${savedPath}`)
        return savedPath
    }

    /**
     * Sony assigns new object handles each time the body re-enters content-transfer mode, which
     * happens whenever live view resumes between listing and downloading. Re-list inside the same
     * paused window and match the file by name, size and capture time.
     */
    async downloadFile(entry: DownloadRequest): Promise<string> {
        return this.withLiveViewPaused(async () => {
            const current = await this.listFilesInner()
            const fresh = current.find(
                candidate => candidate.filename === entry.filename && candidate.sizeBytes === entry.sizeBytes
            )
            if (!fresh) throw new Error(`${entry.filename} is no longer on the card`)
            return this.downloadFileInner(fresh)
        })
    }

    async downloadAll(): Promise<string[]> {
        return this.withLiveViewPaused(() => this.downloadAllInner())
    }

    private async downloadAllInner(): Promise<string[]> {
        const entries = await this.listFilesInner()
        const savedPaths: string[] = []
        for (const [index, entry] of entries.entries()) {
            savedPaths.push(await this.downloadFileInner(entry, { index, count: entries.length }))
        }
        this.finishDownloadProgress(entries.length)
        return savedPaths
    }

    private finishDownloadProgress(count: number): void {
        this.broadcast(IPC_EVENTS.FilesProgress, {
            completed: count,
            total: count,
            currentFilename: '',
            receivedBytes: 0,
            fileBytes: 0,
        } satisfies DownloadProgress)
    }

    private async saveToDownloadDir(filename: string, data: Uint8Array): Promise<string> {
        if (!existsSync(this.downloadDir)) mkdirSync(this.downloadDir, { recursive: true })
        const savedPath = join(this.downloadDir, filename)
        await writeFile(savedPath, data)
        return savedPath
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`
    if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
    return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

export const cameraService = new CameraService()

const VIDEO_MIME_TYPES: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4' }
const IMAGE_MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    hif: 'image/heic',
}

function buildPreview(filename: string, data: Uint8Array): FilePreview {
    const extension = filename.split('.').pop()?.toLowerCase() ?? ''
    if (VIDEO_MIME_TYPES[extension]) return { kind: 'video', mimeType: VIDEO_MIME_TYPES[extension], data }
    if (IMAGE_MIME_TYPES[extension]) return { kind: 'image', mimeType: IMAGE_MIME_TYPES[extension], data }
    const embedded = largestEmbeddedJpeg(data)
    if (embedded) return { kind: 'image', mimeType: 'image/jpeg', data: embedded }
    return { kind: 'unsupported', mimeType: '', data: new Uint8Array() }
}

/**
 * RAW files (Sony ARW, Nikon NEF, Canon CR2…) are TIFF containers that carry full-size JPEG
 * previews. Walks every IFD and SubIFD and returns the largest JPEGInterchangeFormat block.
 */
function largestEmbeddedJpeg(data: Uint8Array): Uint8Array | null {
    if (data.byteLength < 8) return null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const order = String.fromCharCode(data[0], data[1])
    if (order !== 'II' && order !== 'MM') return null
    const littleEndian = order === 'II'
    const u16 = (offset: number): number => view.getUint16(offset, littleEndian)
    const u32 = (offset: number): number => view.getUint32(offset, littleEndian)
    const pending = [u32(4)]
    const visited = new Set<number>()
    let best: { offset: number; length: number } | null = null
    while (pending.length > 0) {
        const ifd = pending.pop() as number
        if (ifd === 0 || ifd + 2 > data.byteLength || visited.has(ifd)) continue
        visited.add(ifd)
        const count = u16(ifd)
        let jpegOffset = 0
        let jpegLength = 0
        for (let index = 0; index < count; index++) {
            const entry = ifd + 2 + index * 12
            if (entry + 12 > data.byteLength) break
            const tag = u16(entry)
            const valueCount = u32(entry + 4)
            if (tag === 0x0201) jpegOffset = u32(entry + 8)
            if (tag === 0x0202) jpegLength = u32(entry + 8)
            if (tag === 0x014a) {
                const first = valueCount === 1 ? entry + 8 : u32(entry + 8)
                for (let sub = 0; sub < valueCount && first + sub * 4 + 4 <= data.byteLength; sub++)
                    pending.push(u32(first + sub * 4))
            }
        }
        const fits = jpegOffset > 0 && jpegLength > 0 && jpegOffset + jpegLength <= data.byteLength
        if (fits && (!best || jpegLength > best.length)) best = { offset: jpegOffset, length: jpegLength }
        const next = ifd + 2 + count * 12
        if (next + 4 <= data.byteLength) pending.push(u32(next))
    }
    return best ? data.slice(best.offset, best.offset + best.length) : null
}
