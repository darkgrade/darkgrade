import { Camera, VendorIDs } from '@darkgrade/link'
import { killMacCameraDaemons } from '@main/macos-camera-daemon'
import type { CameraSettings, CameraState, CaptureResult, DownloadProgress, FileEntry, LogEntry } from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

type Broadcast = (channel: string, payload: unknown) => void
type DeviceDescriptor = NonNullable<ConstructorParameters<typeof Camera>[0]>['device']

const PREVIEWABLE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
const PREVIEW_MAX_BYTES = 40 * 1024 * 1024
const LIVE_VIEW_FRAME_DELAY_MS = 40
const LIVE_VIEW_ERROR_DELAY_MS = 500
const LIVE_VIEW_MAX_CONSECUTIVE_ERRORS = 3
const CONNECT_RETRY_DELAY_MS = 400
const DISCOVERY_ATTEMPTS = 5
const DISCOVERY_RETRY_DELAY_MS = 700
const HOTPLUG_CONNECT_DELAY_MS = 1500
const SETTINGS_READ_TIMEOUT_MS = 5000
const FOCUS_TIMEOUT_MS = 5000
const SETTINGS_EVENT_DEBOUNCE_MS = 400
const SET_APPLY_DELAY_MS = 400
const STILL_IMAGE_CLASS = 0x06

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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_resolve, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ])
}

interface DiscoveredCamera {
    vendorId: number
    productId: number
    name: string
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
            vendor: this.vendorName(),
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

    private vendorName(): string | null {
        if (!this.connected) return null
        const vendorId = this.detectedVendorId ?? this.camera?.getInstance().vendorId
        if (this.detectedName) return this.detectedName
        if (!vendorId) return 'Generic PTP'
        return VENDOR_NAMES[vendorId] ?? 'Generic PTP'
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

    // -------------------------------------------------------- operation queue

    /**
     * PTP allows one transaction at a time. Every camera operation funnels
     * through this queue so live-view frames, captures, and property reads
     * can never interleave on the wire. NOTE: never call enqueue() from
     * inside an enqueued operation — that deadlocks.
     */
    private operationQueue: Promise<unknown> = Promise.resolve()

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operationQueue.then(operation, operation)
        this.operationQueue = result.catch(() => {})
        return result
    }

    // ------------------------------------------------------------- connection

    private connectPromise: Promise<CameraState> | null = null

    /** Serialized: concurrent calls (auto-connect, hotplug, user click) share one attempt. */
    async connect(): Promise<CameraState> {
        if (this.connected) return this.getState()
        if (this.connectPromise) return this.connectPromise
        this.connectPromise = this.connectInternal(true).finally(() => {
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
            const killed = await killMacCameraDaemons()
            if (killed.length > 0) this.log('system', `Killed macOS camera daemon(s): ${killed.join(', ')}`)
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
            this.log('system', `Found ${discovered.name} (VID 0x${discovered.vendorId.toString(16).padStart(4, '0')})`)
        } else {
            this.log('system', 'No camera found via USB discovery — trying generic PTP connect', 'error')
        }

        const device: DeviceDescriptor = discovered
            ? { usb: { filters: [{ vendorId: discovered.vendorId, productId: discovered.productId }] } }
            : undefined

        const camera = new Camera({ logger: { expanded: false }, device })
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
        this.subscribeToCameraEvents()
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

        this.camera = null
        this.connected = false
        this.recording = false
        this.detectedVendorId = null
        this.detectedName = null
        this.settings = { iso: null, shutterSpeed: null, aperture: null }
        this.log('system', 'Disconnected')
        this.broadcastState()
        return this.getState()
    }

    async dispose(): Promise<void> {
        if (this.connected) await this.disconnect().catch(() => {})
    }

    private subscribeToCameraEvents(): void {
        const camera = this.camera
        if (!camera) return
        const registry = camera.getInstance().registry
        for (const [name, definition] of Object.entries(registry.events)) {
            const isPropertyChange = /DevicePropChanged|PropertyChanged/i.test(name)
            try {
                camera.on(
                    definition as never,
                    ((params: unknown) => {
                        if (isPropertyChange) {
                            // The camera applies settings asynchronously (and the
                            // user can turn physical dials) — re-read on change
                            // instead of spamming the log.
                            this.scheduleSettingsRefresh()
                            return
                        }
                        this.log('camera', `${name} ${safeJson(params)}`)
                    }) as never
                )
            } catch {
                // Some vendor registries reject subscriptions for unsupported events
            }
        }
    }

    private settingsRefreshTimer: ReturnType<typeof setTimeout> | null = null

    /** Debounced camera→UI settings sync, driven by DevicePropChanged events. */
    private scheduleSettingsRefresh(): void {
        if (this.settingsRefreshTimer) clearTimeout(this.settingsRefreshTimer)
        this.settingsRefreshTimer = setTimeout(() => {
            this.settingsRefreshTimer = null
            if (this.connected) void this.refreshSettings().catch(() => {})
        }, SETTINGS_EVENT_DEBOUNCE_MS)
    }

    // --------------------------------------------------------------- settings

    /** Runs on the operation queue — never call from inside another enqueued op. */
    private async refreshSettingsRaw(): Promise<CameraSettings> {
        const camera = this.requireCamera()
        this.settings = {
            iso: await withTimeout(camera.getIso(), SETTINGS_READ_TIMEOUT_MS, 'getIso').catch(() => null),
            shutterSpeed: await withTimeout(
                camera.getShutterSpeed(),
                SETTINGS_READ_TIMEOUT_MS,
                'getShutterSpeed'
            ).catch(() => null),
            aperture: await withTimeout(camera.getAperture(), SETTINGS_READ_TIMEOUT_MS, 'getAperture').catch(
                () => null
            ),
        }
        this.broadcastState()
        return this.settings
    }

    async refreshSettings(): Promise<CameraSettings> {
        return this.enqueue(() => this.refreshSettingsRaw())
    }

    async setIso(value: string): Promise<CameraSettings> {
        return this.enqueue(async () => {
            await this.requireCamera().setIso(value)
            this.log('system', `ISO → ${value}`)
            // Sony applies asynchronously — give it a beat before reading back.
            // DevicePropChanged events keep the UI in sync after this too.
            await delay(SET_APPLY_DELAY_MS)
            return this.refreshSettingsRaw()
        })
    }

    async setShutterSpeed(value: string): Promise<CameraSettings> {
        return this.enqueue(async () => {
            await this.requireCamera().setShutterSpeed(value)
            this.log('system', `Shutter → ${value}`)
            await delay(SET_APPLY_DELAY_MS)
            return this.refreshSettingsRaw()
        })
    }

    async setAperture(value: string): Promise<CameraSettings> {
        return this.enqueue(async () => {
            await this.requireCamera().setAperture(value)
            this.log('system', `Aperture → ${value}`)
            await delay(SET_APPLY_DELAY_MS)
            return this.refreshSettingsRaw()
        })
    }

    // ------------------------------------------------------------------ focus

    /**
     * Half-press autofocus (Sony S1 button): press, wait for the camera's
     * AFStatus FOCUSED event, release. Same mechanism captureImage uses.
     */
    async focus(): Promise<string> {
        const camera = this.requireCamera()
        return this.enqueue(async () => {
            const registry = camera.getInstance().registry
            const properties = registry.properties as Record<string, unknown>
            const events = registry.events as Record<string, unknown>
            const halfPressButton = properties.ShutterHalfReleaseButton
            const afStatusEvent = events.SDIE_AFStatus
            if (!halfPressButton) throw new Error('Autofocus is not supported on this camera')

            let resolveFocused: (status: string) => void = () => {}
            const focused = new Promise<string>(resolve => {
                resolveFocused = resolve
            })
            const onAfStatus = (params: { Status?: unknown }): void => {
                const status = String(params?.Status ?? '')
                if (status.includes('FOCUSED') && !status.includes('NOT')) resolveFocused(status)
            }

            if (afStatusEvent) camera.on(afStatusEvent as never, onAfStatus as never)
            try {
                await camera.set(halfPressButton as never, 'DOWN' as never)
                const status = await withTimeout(focused, FOCUS_TIMEOUT_MS, 'Autofocus')
                this.log('system', `Focus acquired (${status})`)
                return status
            } finally {
                if (afStatusEvent) camera.off(afStatusEvent as never, onAfStatus as never)
                await camera.set(halfPressButton as never, 'UP' as never).catch(() => {})
            }
        })
    }

    // ---------------------------------------------------------------- capture

    async capture(): Promise<CaptureResult> {
        const camera = this.requireCamera()
        const { info, data } = await this.enqueue(() => camera.captureImage())
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
            while (!this.liveViewStopRequested && this.connected && this.camera) {
                const camera = this.camera
                try {
                    const { data } = await this.enqueue(() => camera.captureLiveView({ includeInfo: false }))
                    if (data && !this.liveViewStopRequested) {
                        this.broadcast(IPC_EVENTS.LiveViewFrame, data)
                    }
                    consecutiveErrors = 0
                } catch (error) {
                    consecutiveErrors++
                    const message = errorMessage(error)
                    if (/not supported/i.test(message)) {
                        this.log('system', `Live view unavailable: ${message}`, 'error')
                        break
                    }
                    if (consecutiveErrors >= LIVE_VIEW_MAX_CONSECUTIVE_ERRORS) {
                        this.log('system', `Live view stopped after repeated errors: ${message}`, 'error')
                        break
                    }
                    this.log('system', `Live view frame error: ${message}`, 'error')
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
    private async withLiveViewPaused<T>(operation: () => Promise<T>): Promise<T> {
        const wasRunning = this.liveViewRunning
        if (wasRunning) await this.stopLiveView()
        try {
            return await operation()
        } finally {
            if (wasRunning && this.connected) {
                void this.startLiveView().catch(error =>
                    this.log('system', `Live view resume failed: ${errorMessage(error)}`, 'error')
                )
            }
        }
    }

    // -------------------------------------------------------------- recording

    async startRecording(): Promise<CameraState> {
        const camera = this.requireCamera()
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
        this.broadcastState()
        return this.getState()
    }

    // ------------------------------------------------------------------ files

    private async listFilesInner(): Promise<FileEntry[]> {
        const camera = this.requireCamera()
        const storages = await this.enqueue(() => camera.listObjects())
        const entries: FileEntry[] = []
        for (const [storageId, storage] of Object.entries(storages)) {
            for (const [objectHandle, info] of Object.entries(storage.objects)) {
                entries.push({
                    storageId: Number(storageId),
                    storageDescription: String(storage.info?.storageDescription ?? ''),
                    objectHandle: Number(objectHandle),
                    filename: String(info.filename ?? `object-${objectHandle}`),
                    sizeBytes: Number(info.objectCompressedSize ?? 0),
                    format: String(info.objectFormatDecoded ?? info.objectFormat ?? ''),
                    captureDate: String(info.captureDate ?? ''),
                })
            }
        }
        this.log('system', `Listed ${entries.length} file(s) across ${Object.keys(storages).length} storage(s)`)
        return entries
    }

    private async downloadFileInner(
        entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>
    ): Promise<string> {
        const camera = this.requireCamera()
        const data = await this.enqueue(() => camera.getObject(entry.objectHandle, entry.sizeBytes))
        const savedPath = await this.saveToDownloadDir(entry.filename, data)
        this.log('system', `Downloaded ${entry.filename} → ${savedPath}`)
        return savedPath
    }

    async listFiles(): Promise<FileEntry[]> {
        return this.withLiveViewPaused(() => this.listFilesInner())
    }

    async downloadFile(entry: Pick<FileEntry, 'objectHandle' | 'sizeBytes' | 'filename'>): Promise<string> {
        return this.withLiveViewPaused(() => this.downloadFileInner(entry))
    }

    async downloadAll(): Promise<string[]> {
        return this.withLiveViewPaused(() => this.downloadAllInner())
    }

    private async downloadAllInner(): Promise<string[]> {
        const entries = await this.listFilesInner()
        const savedPaths: string[] = []
        for (const [index, entry] of entries.entries()) {
            const progress: DownloadProgress = {
                completed: index,
                total: entries.length,
                currentFilename: entry.filename,
            }
            this.broadcast(IPC_EVENTS.FilesProgress, progress)
            savedPaths.push(await this.downloadFileInner(entry))
        }
        this.broadcast(IPC_EVENTS.FilesProgress, {
            completed: entries.length,
            total: entries.length,
            currentFilename: '',
        } satisfies DownloadProgress)
        return savedPaths
    }

    private async saveToDownloadDir(filename: string, data: Uint8Array): Promise<string> {
        if (!existsSync(this.downloadDir)) mkdirSync(this.downloadDir, { recursive: true })
        const savedPath = join(this.downloadDir, filename)
        await writeFile(savedPath, data)
        return savedPath
    }
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value, (_key, val) => (typeof val === 'bigint' ? val.toString() : val)) ?? ''
    } catch {
        return String(value)
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const cameraService = new CameraService()
