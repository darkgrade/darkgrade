import type { CameraCapabilities } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'

/** The camera service's zoom and the lens readout. Installed on CameraService in camera-service.ts. */
export interface ZoomOperations {
    /** The lens and whether the zoom buttons can drive it, from the same reading as the settings. */
    updateLensFromCapabilities(capabilities: CameraCapabilities): void
    /**
     * Press-and-hold zoom: one quick command to start and one to stop, so live view keeps running
     * while the lens moves. Slate stops the zoom by itself after ten seconds if the release is lost.
     */
    zoomStart(direction: 'wide' | 'tele'): Promise<void>
    zoomStop(): Promise<void>
}

export const zoomOperations: ZoomOperations & ThisType<CameraService> = {
    updateLensFromCapabilities(capabilities: CameraCapabilities): void {
        const zoom = capabilities.operations?.startZoom
        this.lens = {
            name: capabilities.lens?.name ?? null,
            focalLengthMillimetres: capabilities.lens?.focalLengthMillimetres ?? null,
            zoom: { supported: zoom?.supported === true, reason: zoom?.supported ? null : (zoom?.reason ?? null) },
        }
    },

    async zoomStart(direction: 'wide' | 'tele'): Promise<void> {
        const camera = this.requireCameraForControl()
        const releasesAtPress = this.zoomReleases
        await this.enqueue(async () => {
            // Released while this press waited in the queue: the stop already went out, so never start.
            if (this.zoomReleases !== releasesAtPress) return
            await camera.startZoom(direction === 'tele' ? 'in' : 'out', { speed: 'fast' })
        })
    },

    /**
     * Stop is never blocked: it goes straight to the camera instead of waiting behind queued work,
     * and cancels a press still waiting in the queue. Slate itself drops a start a stop overtakes.
     */
    async zoomStop(): Promise<void> {
        this.zoomReleases++
        const camera = this.camera
        if (!camera || !this.connected) return
        await camera.stopZoom()
        this.scheduleSettingsRefresh()
    },
}
