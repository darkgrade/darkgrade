import { readCameraPower, VendorIDs } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import {
    BATTERY_POLL_INTERVAL_MS,
    CLOCK_SYNC_INTERVAL_MS,
    errorMessage,
    requiresReconnect,
    vendorKind,
} from '@main/camera-service/shared'

/** The camera service's battery and clock. Installed on CameraService in camera-service.ts. */
export interface BodyOperations {
    // ------------------------------------------------------------------ clock

    /** The computer is the source of truth: set the camera clock now and every hour after. */
    startClockSync(): void
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
        if (this.clockTimer) clearInterval(this.clockTimer)
        void this.syncClock()
        this.clockTimer = setInterval(() => void this.syncClock(), CLOCK_SYNC_INTERVAL_MS)
    },

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
    },
}
