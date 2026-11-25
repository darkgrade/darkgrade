import { VendorIDs } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import { ZOOM_SAFETY_STOP_MS } from '@main/camera-service/shared'

/** The camera service's zoom and the lens readout. Installed on CameraService in camera-service.ts. */
export interface ZoomOperations {
    /** Sony reports the lens name and the zoom position in thousandths of a millimetre. */
    updateLensFromStates(
        states: Array<{
            name: string
            value: unknown
            rawValue: unknown
        }>
    ): void
    /**
     * Press-and-hold zoom: one quick command to start and one to stop, so live view keeps running
     * while the lens moves. The focal length follows through the camera's property-change events.
     */
    zoomStart(direction: 'wide' | 'tele'): Promise<void>
    zoomStop(): Promise<void>
}

export const zoomOperations: ZoomOperations & ThisType<CameraService> = {
    /** Sony reports the lens name and the zoom position in thousandths of a millimetre. */
    updateLensFromStates(states: Array<{ name: string; value: unknown; rawValue: unknown }>): void {
        const name = states.find(state => state.name === 'LensModelName')?.value
        const zoom = Number(states.find(state => state.name === 'ZoomDistance')?.rawValue)
        this.lens = {
            name: typeof name === 'string' && name.trim() ? name.trim() : null,
            focalLengthMillimetres: Number.isFinite(zoom) && zoom > 0 ? zoom / 1000 : null,
        }
    },

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
    },

    async zoomStop(): Promise<void> {
        if (this.zoomSafetyTimer) clearTimeout(this.zoomSafetyTimer)
        this.zoomSafetyTimer = null
        const camera = this.camera
        if (!camera || !this.connected || this.detectedVendorId !== VendorIDs.SONY) return
        await this.enqueue(() => camera.sonyStopZoom())
        this.scheduleSettingsRefresh()
    },
}
