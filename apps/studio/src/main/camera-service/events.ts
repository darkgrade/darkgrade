import type { CameraService } from '@main/camera-service'
import { SETTINGS_EVENT_DEBOUNCE_MS } from '@main/camera-service/shared'

/** The camera service's camera events and settings-change refreshes. Installed on CameraService in camera-service.ts. */
export interface EventsOperations {
    subscribeToCameraEvents(): void
    /** Debounced camera→UI settings sync, driven by DevicePropChanged events. */
    scheduleSettingsRefresh(): void
}

export const eventsOperations: EventsOperations & ThisType<CameraService> = {
    subscribeToCameraEvents(): void {
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
    },

    /** Debounced camera→UI settings sync, driven by DevicePropChanged events. */
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
