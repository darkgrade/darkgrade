import { Camera, PTPResponseError, PTPTimeoutError, VendorIDs, type SonyFocalFrame } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    LIVE_VIEW_ERROR_DELAY_MS,
    LIVE_VIEW_FRAME_DELAY_MS,
    LIVE_VIEW_MAX_CONSECUTIVE_ERRORS,
    LIVE_VIEW_STATISTICS_INTERVAL_MS,
    OSD_FRAME_INTERVAL_MS,
    PTP_ACCESS_DENIED,
    RECOVERY_RECONNECT_DELAY_MS,
    delay,
    errorMessage,
    requiresReconnect,
} from '@main/camera-service/shared'
import { runSwiftLiveView, stopSwiftLiveView } from '@main/usb-experiments'
import type { CameraState, FocusFrame } from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'

/** The camera service's live view, focus frames and the camera overlay. Installed on CameraService in camera-service.ts. */
export interface LiveViewOperations {
    /** Turns the camera's on-screen display over live view on or off (Sony). */
    setOsdOverlay(enabled: boolean): Promise<CameraState>
    /** Between live-view frames, a fresh on-screen display a few times a second while the overlay is on. */
    refreshOsdFrame(camera: Camera): Promise<void>
    broadcastFocusFrames(frames: SonyFocalFrame[]): void
    // -------------------------------------------------------------- live view

    startLiveView(): Promise<CameraState>
    /**
     * EXPERIMENT(usb-transport): the transport is chosen when a connection is made, so a change of choice remakes
     * the connection (live view starts again with it). A recording isn't interrupted: the choice then waits for the
     * next connection.
     */
    reconnectForUsbTransport(choice: string): void
    /** EXPERIMENT(usb-transport): true once the Swift live-view loop has run and ended; false when it isn't chosen. */
    runSwiftLiveViewIfChosen(): Promise<boolean>
    stopLiveView(): Promise<CameraState>
    /**
     * Sony card downloads switch the body into "content transfer" mode — a playback-like state —
     * while live view requires shooting mode. Interleaving them makes the camera flip modes per
     * frame and the live view stream shows recorded card images instead of the sensor feed. So:
     * pause live view, do the card work, resume; Slate returns the body to shooting on the next frame.
     */
    withLiveViewPaused<T>(operation: () => Promise<T>): Promise<T>
}

export const liveViewOperations: LiveViewOperations & ThisType<CameraService> = {
    /** Turns the camera's on-screen display over live view on or off (Sony). */
    async setOsdOverlay(enabled: boolean): Promise<CameraState> {
        const camera = this.requireCameraForControl()
        if (this.detectedVendorId !== VendorIDs.SONY) throw new Error('Only Sony cameras send their on-screen display')
        this.osdOverlay = enabled
        if (!enabled) await this.enqueue(() => camera.setSonyOsdImageMode(false))
        this.log('system', `Camera display overlay ${enabled ? 'on' : 'off'}`)
        this.broadcastState()
        return this.getState()
    },

    /** Between live-view frames, a fresh on-screen display a few times a second while the overlay is on. */
    async refreshOsdFrame(camera: Camera): Promise<void> {
        if (!this.osdOverlay || Date.now() - this.lastOsdFrameMs < OSD_FRAME_INTERVAL_MS) return
        this.lastOsdFrameMs = Date.now()
        try {
            const { image } = await this.enqueue(() => camera.captureSonyOsdImage())
            if (this.osdOverlay) this.broadcast(IPC_EVENTS.OsdFrame, image)
        } catch (error) {
            if (requiresReconnect(error)) throw error
        }
    },

    broadcastFocusFrames(frames: SonyFocalFrame[]): void {
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
    },

    // -------------------------------------------------------------- live view

    async startLiveView(): Promise<CameraState> {
        this.requireCamera()
        if (this.liveViewRunning) return this.getState()

        this.liveViewRunning = true
        this.liveViewStopRequested = false
        this.log('system', 'Live view started')
        this.broadcastState()

        this.liveViewLoopDone = (async () => {
            // EXPERIMENT(usb-transport): the Swift live-view loop fetches the frames itself when it is the choice.
            if (await this.runSwiftLiveViewIfChosen()) return
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
                        this.latestNodeFrame = data
                        this.broadcast(IPC_EVENTS.LiveViewFrame, data)
                        this.broadcastFocusFrames(sonyFocalFrames ?? [])
                        await this.refreshOsdFrame(camera)
                    }
                    consecutiveErrors = 0
                } catch (error) {
                    consecutiveErrors++
                    const message = errorMessage(error)
                    if (requiresReconnect(error)) break
                    // AccessDenied: Slate already tried returning the body to shooting once; ask again shortly.
                    if (error instanceof PTPResponseError && error.code === PTP_ACCESS_DENIED) {
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
    },

    /**
     * EXPERIMENT(usb-transport): the transport is chosen when a connection is made, so a change of choice remakes
     * the connection (live view starts again with it). A recording isn't interrupted: the choice then waits for the
     * next connection.
     */
    reconnectForUsbTransport(choice: string): void {
        if (!this.connected || this.recoveryInProgress) return
        if (this.recording) {
            this.log('system', `USB transport ${choice} applies from the next connection: a recording is running`)
            return
        }
        this.recoveryInProgress = true
        this.log('system', `USB transport changed to ${choice}: reconnecting…`)
        void (async () => {
            try {
                await this.disconnect()
                await delay(RECOVERY_RECONNECT_DELAY_MS)
                await this.connect()
            } catch (error) {
                this.log('system', `Reconnecting failed: ${errorMessage(error)}: replug the camera`, 'error')
            } finally {
                this.recoveryInProgress = false
                this.broadcastState()
            }
        })()
    },

    /** EXPERIMENT(usb-transport): true once the Swift live-view loop has run and ended; false when it isn't chosen. */
    async runSwiftLiveViewIfChosen(): Promise<boolean> {
        const camera = this.camera
        if (!camera) return false
        try {
            const ran = await runSwiftLiveView({
                camera,
                enqueue: operation => this.enqueue(operation),
                broadcast: (channel, payload) => this.broadcast(channel, payload),
                broadcastFocusFrames: frames => this.broadcastFocusFrames(frames),
                refreshOsdFrame: () => this.refreshOsdFrame(camera),
                stopRequested: () => this.liveViewStopRequested,
                stillConnected: () => this.connected && this.camera === camera,
                log: (message, isError) => this.log('system', message, isError ? 'error' : undefined),
            })
            if (!ran) return false
        } catch (error) {
            this.log('system', `The Swift live-view loop failed: ${errorMessage(error)}`, 'error')
        }
        this.liveViewRunning = false
        this.broadcastState()
        return true
    },

    async stopLiveView(): Promise<CameraState> {
        if (this.liveViewRunning) {
            this.liveViewStopRequested = true
            stopSwiftLiveView() // EXPERIMENT(usb-transport)
            this.log('system', 'Live view stopped')
        }
        // Wait for the frame loop to actually exit so no live-view operation
        // can interleave with whatever runs next (e.g. storage access).
        if (this.liveViewLoopDone) await this.liveViewLoopDone.catch(() => {})
        this.liveViewRunning = false
        this.broadcastState()
        return this.getState()
    },

    async withLiveViewPaused<T>(operation: () => Promise<T>): Promise<T> {
        const wasRunning = this.liveViewRunning
        if (wasRunning) await this.stopLiveView()
        this.storageSessionActive = true
        try {
            return await operation()
        } finally {
            // Slate returns a Sony body to shooting by itself on the next live-view frame.
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
    },
}
