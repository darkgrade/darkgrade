import { Camera } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    CONNECT_RETRY_DELAY_MS,
    DISCOVERY_ATTEMPTS,
    DISCOVERY_RETRY_DELAY_MS,
    DeviceDescriptor,
    DiscoveredCamera,
    FILES_REFRESH_DELAY_MS,
    HOTPLUG_CONNECT_DELAY_MS,
    KNOWN_CAMERA_VENDOR_IDS,
    TRANSACTION_POLICY,
    VENDOR_NAMES,
    delay,
    discoverCamera,
    errorMessage,
    requestedCamera,
    requiresReconnect,
    vendorIdForMake,
} from '@main/camera-service/shared'
import { killMacCameraDaemons } from '@main/macos-camera-daemon'
import { experimentalCameraOptions } from '@main/usb-experiments'
import type { CameraState } from '@shared/ipc'

/** The camera service's connecting, discovery, hotplug, disconnect and recovery. Installed on CameraService in camera-service.ts. */
export interface ConnectionOperations {
    /** Serialized: concurrent calls (auto-connect, hotplug, user click) share one attempt. */
    connect(): Promise<CameraState>
    /**
     * Discovery races the macOS camera daemon: while ptpcamerad holds the
     * device, node-usb cannot open it and it is invisible to enumeration.
     * Kill, wait, retry — the 1s killer loop guarantees a clear window.
     */
    discoverWithRetry(attempts: number): Promise<DiscoveredCamera | null>
    connectInternal(): Promise<CameraState>
    // --------------------------------------------------------------- hotplug

    /** Auto-connect when a known camera is plugged in; clean up when unplugged. */
    startAutoDetect(): void
    /**
     * While the camera is still reachable, an unconfirmed Stop keeps the connection so Stop stays
     * available. Once the transport is gone (unplugged, or Slate reports the session lost) there is
     * nothing left to stop or restore, so the session is torn down and a replug can reconnect.
     */
    disconnect(options?: { transportLost?: boolean }): Promise<CameraState>
    disconnectSession(transportLost: boolean): Promise<void>
    dispose(): Promise<void>
}

export const connectionOperations: ConnectionOperations & ThisType<CameraService> = {
    /** Serialized: concurrent calls (auto-connect, hotplug, user click) share one attempt. */
    async connect(): Promise<CameraState> {
        if (this.connected) return this.getState()
        if (this.connectPromise) return this.connectPromise
        if (!this.recoveryInProgress) this.phase = 'connecting'
        this.broadcastState()
        this.connectPromise = this.connectInternal()
            .catch(error => {
                if (!this.recoveryInProgress) this.phase = 'idle'
                this.broadcastState()
                throw error
            })
            .finally(() => {
                this.connectPromise = null
            })
        return this.connectPromise
    },

    /**
     * Discovery races the macOS camera daemon: while ptpcamerad holds the
     * device, node-usb cannot open it and it is invisible to enumeration.
     * Kill, wait, retry — the 1s killer loop guarantees a clear window.
     */
    async discoverWithRetry(attempts: number): Promise<DiscoveredCamera | null> {
        for (let attempt = 0; attempt < attempts; attempt++) {
            await killMacCameraDaemons()
            const discovered = await discoverCamera()
            if (discovered) return discovered
            await delay(DISCOVERY_RETRY_DELAY_MS)
        }
        return null
    },

    async connectInternal(): Promise<CameraState> {
        // Discover the device first so Camera opens that exact body; DARKGRADE_CAMERA=VID:PID picks one of several.
        const requested = requestedCamera()
        const discovered = await this.discoverWithRetry(DISCOVERY_ATTEMPTS)
        if (discovered) {
            this.detectedVendorId = discovered.vendorId
            this.detectedName = discovered.name
            this.detectedModel = discovered.model
            this.log('system', `Found ${discovered.name} (VID 0x${discovered.vendorId.toString(16).padStart(4, '0')})`)
        } else {
            this.log('system', 'No camera found via USB discovery — trying generic PTP connect', 'error')
        }

        const filter = discovered ? { vendorId: discovered.vendorId, productId: discovered.productId } : requested
        const device: DeviceDescriptor = filter ? { usb: { filters: [filter] } } : undefined

        const camera = new Camera({
            logger: { expanded: false, renderInTerminal: false, captureConsole: false },
            device,
            transactionPolicy: TRANSACTION_POLICY,
            // EXPERIMENT(usb-transport): the chosen transport's options; none by default.
            ...experimentalCameraOptions(filter?.vendorId, message => this.log('system', message)),
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

        // Slate selects the actual opened USB body's driver, including when discovery missed it.
        this.cameraInfo = await camera.getInfo().catch(error => {
            this.log('system', `Camera identity read failed: ${errorMessage(error)}`, 'error')
            return null
        })
        this.detectedVendorId ??= vendorIdForMake(this.cameraInfo?.manufacturer)
        if (this.cameraInfo) this.detectedModel ??= this.cameraInfo.model

        this.camera = camera
        this.connected = true
        this.phase = 'connected'
        this.subscribeToCameraEvents()
        this.startBatteryPolling()
        this.startClockSync()
        this.previewCache.clear()
        this.scheduleFilesRefresh(FILES_REFRESH_DELAY_MS * 2)
        this.log(
            'system',
            `Connected to ${this.cameraInfo ? `${this.cameraInfo.manufacturer} ${this.cameraInfo.model}` : this.vendorName()}`
        )

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
    },

    // --------------------------------------------------------------- hotplug

    /** Auto-connect when a known camera is plugged in; clean up when unplugged. */
    startAutoDetect(): void {
        void (async () => {
            try {
                const { usb } = await import('usb')
                usb.on('attach', device => {
                    const vendorId = device?.deviceDescriptor?.idVendor
                    if (!vendorId || !KNOWN_CAMERA_VENDOR_IDS.has(vendorId) || this.connected) return
                    const productId = device.deviceDescriptor.idProduct
                    void delay(HOTPLUG_CONNECT_DELAY_MS)
                        .then(() => {
                            const requested = requestedCamera()
                            if (requested && (requested.vendorId !== vendorId || requested.productId !== productId)) return
                            this.log('system', `${VENDOR_NAMES[vendorId]} camera plugged in — connecting…`)
                            return this.connect()
                        })
                        .catch(error => this.log('system', `Auto-connect failed: ${errorMessage(error)}`, 'error'))
                })
                usb.on('detach', device => {
                    const vendorId = device?.deviceDescriptor?.idVendor
                    if (!this.connected || !vendorId || vendorId !== this.detectedVendorId) return
                    this.log('system', 'Camera unplugged', 'error')
                    void this.disconnect({ transportLost: true }).catch(() => {})
                })
            } catch (error) {
                this.log('system', `USB hotplug watch unavailable: ${errorMessage(error)}`, 'error')
            }
        })()
    },

    /**
     * While the camera is still reachable, an unconfirmed Stop keeps the connection so Stop stays
     * available. Once the transport is gone (unplugged, or Slate reports the session lost) there is
     * nothing left to stop or restore, so the session is torn down and a replug can reconnect.
     */
    async disconnect(options: { transportLost?: boolean } = {}): Promise<CameraState> {
        this.disconnecting = true
        try {
            await this.disconnectSession(options.transportLost === true)
        } finally {
            this.disconnecting = false
        }

        this.stopBatteryPolling()
        this.camera = null
        this.connected = false
        if (!this.recoveryInProgress) this.phase = 'idle'
        this.recording = false
        this.recordingState = 'idle'
        this.battery = null
        this.controls = null
        this.card = null
        this.lens = null
        this.clock = null
        this.stopClockSync()
        this.cameraInfo = null
        this.detectedVendorId = null
        this.detectedName = null
        this.detectedModel = null
        this.focusPointAvailable = false
        this.focusFramesKey = '[]'
        this.osdOverlay = false
        this.overlaySupported = false
        this.settings = { iso: null, shutterSpeed: null, aperture: null }
        this.log('system', 'Disconnected')
        this.broadcastState()
        return this.getState()
    },

    async disconnectSession(transportLost: boolean): Promise<void> {
        await this.stopLiveView().catch(() => {})
        if (this.recording) {
            try {
                await this.stopRecording()
            } catch (error) {
                if (!transportLost && !requiresReconnect(error)) throw error
                transportLost = true
            }
        }
        if (transportLost && this.recording)
            this.log('system', 'Camera lost while recording; its recording and setup could not be confirmed', 'error')

        if (this.camera) {
            const camera = this.camera
            try {
                await this.enqueue(async () => {
                    if (!transportLost && this.recording)
                        throw new Error('Stop and confirm the recording before disconnecting')
                    await camera.disconnect()
                })
            } catch (error) {
                this.log('system', `Disconnect error: ${errorMessage(error)}`, 'error')
                if (!transportLost && this.recording) throw error
            }
        }
    },

    async dispose(): Promise<void> {
        if (this.connected) await this.disconnect().catch(() => {})
    },
}
