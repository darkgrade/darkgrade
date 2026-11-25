import type { CameraService } from '@main/camera-service'
import { SETTINGS_EVENT_DEBOUNCE_MS, errorMessage } from '@main/camera-service/shared'

/** The camera service's camera events and settings-change refreshes. Installed on CameraService in camera-service.ts. */
export interface EventsOperations {
    subscribeToCameraEvents(): void
    /** Debounced camera→UI settings sync, driven by settingsChanged events. */
    scheduleSettingsRefresh(): void
}

export const eventsOperations: EventsOperations & ThisType<CameraService> = {
    subscribeToCameraEvents(): void {
        const camera = this.camera
        if (!camera) return
        // The camera applies settings asynchronously (and the user can turn physical dials):
        // re-read settings whenever it reports a change, and the card whenever a file lands.
        try {
            camera.on('settingsChanged', () => this.scheduleSettingsRefresh())
            camera.on('mediaAdded', () => this.scheduleFilesRefresh())
        } catch (error) {
            this.log('system', `Camera events unavailable: ${errorMessage(error)}`)
        }
    },

    /** Debounced camera→UI settings sync, driven by settingsChanged events. */
    scheduleSettingsRefresh(): void {
        if (this.settingsRefreshTimer) clearTimeout(this.settingsRefreshTimer)
        this.settingsRefreshTimer = setTimeout(() => {
            this.settingsRefreshTimer = null
            if (this.storageSessionActive) {
                this.settingsRefreshDeferred = true
                return
            }
            if (this.connected) void this.refreshSettings().catch(() => {})
        }, SETTINGS_EVENT_DEBOUNCE_MS)
    },
}
