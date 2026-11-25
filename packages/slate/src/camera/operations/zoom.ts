import type { Camera } from '@camera/index'
import { cameraContext } from '@camera/operations/context'
import { SonyCamera, type SonyZoomResult } from '@camera/sony-camera'

export interface ZoomOperations {
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
