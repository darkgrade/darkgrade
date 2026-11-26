import { CameraUnsupportedError } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    BATTERY_POLL_INTERVAL_MS,
    CLOCK_SYNC_INTERVAL_MS,
    errorMessage,
    requiresReconnect,
} from '@main/camera-service/shared'

/** The camera service's battery and clock. Installed on CameraService in camera-service.ts. */
export interface BodyOperations {
    // ------------------------------------------------------------------ clock

    /** The computer is the source of truth: set the camera clock now and every hour after. */
    startClockSync(): void
    stopClockSync(): void
    /** Pushes this computer's time to the camera. Never reads the camera's clock. */
    syncClock(): Promise<void>
    // ---------------------------------------------------------------- battery

    startBatteryPolling(): void
    stopBatteryPolling(): void
    refreshBattery(): Promise<void>
}

export const bodyOperations: BodyOperations & ThisType<CameraService> = {
    // ------------------------------------------------------------------ clock

    /** The computer is the source of truth: set the camera clock now and every hour after. */
    startClockSync(): void {
        this.stopClockSync()
        void this.syncClock()
        this.clockTimer = setInterval(() => void this.syncClock(), CLOCK_SYNC_INTERVAL_MS)
    },

    stopClockSync(): void {
        if (this.clockTimer) clearInterval(this.clockTimer)
        this.clockTimer = null
    },

    /** Pushes this computer's time to the camera. Never reads the camera's clock. */
    async syncClock(): Promise<void> {
        const camera = this.camera
        if (!camera || !this.connected) return
        if (this.storageSessionActive || this.recording) return
        try {
            // Taken inside the queue so the time sent is the time the command runs.
            await this.enqueue(() => camera.setClock(new Date()))
            this.clock = { syncedAtMs: Date.now(), error: null }
        } catch (error) {
            if (requiresReconnect(error)) return
            // A camera that doesn't offer its clock has nothing to show or retry.
            if (error instanceof CameraUnsupportedError) {
                this.stopClockSync()
                this.clock = null
                this.broadcastState()
                return
            }
            this.clock = { syncedAtMs: this.clock?.syncedAtMs ?? null, error: errorMessage(error) }
            this.log('system', `Couldn't set the camera clock: ${errorMessage(error)}`, 'error')
        }
        this.broadcastState()
    },

    // ---------------------------------------------------------------- battery

    startBatteryPolling(): void {
        this.stopBatteryPolling()
        void this.refreshBattery()
        this.batteryTimer = setInterval(() => void this.refreshBattery(), BATTERY_POLL_INTERVAL_MS)
    },

    stopBatteryPolling(): void {
        if (this.batteryTimer) clearInterval(this.batteryTimer)
        this.batteryTimer = null
    },

    async refreshBattery(): Promise<void> {
        const camera = this.camera
        if (!camera || !this.connected || this.storageSessionActive) return
        try {
            const battery = await this.enqueue(() => camera.getBattery())
            this.battery = {
                percent: battery.percent ?? null,
                level: battery.level ?? null,
                powerSource: battery.powerSource,
                remainingMinutes: battery.minutesRemaining ?? null,
            }
            this.broadcastState()
        } catch (error) {
            if (error instanceof CameraUnsupportedError) {
                this.battery = null
                this.broadcastState()
            }
            // Battery telemetry is best-effort; a dead session is handled by enqueue's recovery.
        }
    },
}
