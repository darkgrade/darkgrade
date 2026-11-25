import type { ZoomDirection, ZoomOptions } from '@camera/driver/zoom'
import type { Camera } from '@camera/index'
import { cameraContext, driverCapabilities, requireCapability } from '@camera/operations/context'
import { SonyCamera, type SonyZoomResult } from '@camera/sony-camera'

export interface ZoomOperations {
    /**
     * Zooms to a focal length ("go to 35") and resolves to the focal length, in millimetres, where
     * the lens landed, read back from the camera. Needs a power-zoom lens that reports its focal length.
     */
    zoomTo(focalLengthMillimetres: number): Promise<number>
    /**
     * Zooms until stopZoom, like holding a zoom rocker, and returns once the camera accepted the
     * command. Slate stops the zoom by itself after 10 seconds.
     */
    startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void>
    /** Stops zooming. Always allowed: it never waits behind another operation, and resolves on a camera without zoom. */
    stopZoom(): Promise<void>
    getSonyZoomPosition(): Promise<number>
    /** Sony: start zooming and return immediately; call sonyStopZoom() to stop. */
    sonyStartZoom(direction: 'wide' | 'tele', speed?: number): Promise<void>
    sonyStopZoom(): Promise<void>
    sonyPowerZoom(direction: 'wide' | 'tele', pulses?: number): Promise<SonyZoomResult>
}

function sonyDriver(camera: Camera, unavailable: string): SonyCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof SonyCamera)) throw new Error(unavailable)
    return driver
}

const sonyZoomUnavailable = 'Sony zoom is only available for Sony cameras'

export const zoomOperations: ZoomOperations & ThisType<Camera> = {
    async zoomTo(focalLengthMillimetres: number): Promise<number> {
        return requireCapability(this, 'zoom', 'zoomTo').zoomTo(focalLengthMillimetres)
    },

    async startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void> {
        await requireCapability(this, 'zoom', 'startZoom').startZoom(direction, options)
    },

    async stopZoom(): Promise<void> {
        // Nothing can be zooming on a camera without a zoom capability, so stopping succeeds there.
        await driverCapabilities(this).zoom?.stopZoom()
    },

    async getSonyZoomPosition(): Promise<number> {
        return sonyDriver(this, 'Sony zoom position is only available for Sony cameras').getZoomPosition()
    },

    async sonyStartZoom(direction: 'wide' | 'tele', speed?: number): Promise<void> {
        await sonyDriver(this, sonyZoomUnavailable).startZoom(direction, speed)
    },

    async sonyStopZoom(): Promise<void> {
        await sonyDriver(this, sonyZoomUnavailable).stopZoom()
    },

    async sonyPowerZoom(direction: 'wide' | 'tele', pulses?: number): Promise<SonyZoomResult> {
        return sonyDriver(this, 'Sony power zoom is only available for Sony cameras').powerZoom(direction, pulses)
    },
}
