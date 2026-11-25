import type { OperationAvailability } from '@camera/controls'

export type ZoomDirection = 'in' | 'out'
export type ZoomSpeed = 'slow' | 'medium' | 'fast'

export interface ZoomOptions {
    speed: ZoomSpeed
}

/** The longest a zoom started with startZoom runs before Slate stops it by itself. */
export const ZOOM_SAFETY_STOP_MILLISECONDS = 10_000

/**
 * The zoom capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can drive a zoom provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError.
 */
export interface ZoomCapability {
    /** Resolves to the focal length, in millimetres, where the lens landed (read back, never assumed). */
    zoomTo(focalLengthMillimetres: number): Promise<number>
    /** Starts zooming and returns; the capability stops by itself after ZOOM_SAFETY_STOP_MILLISECONDS. */
    startZoom(direction: ZoomDirection, options: ZoomOptions): Promise<void>
    /** Always allowed: never waits for another operation and never refused for the camera's mode. */
    stopZoom(): Promise<void>
    /** Support for each zoom operation from the camera's latest observation; sends nothing. */
    availability(): Record<'zoomTo' | 'startZoom' | 'stopZoom', OperationAvailability>
}
