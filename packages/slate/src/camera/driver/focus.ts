import type { CameraCapabilities, OperationAvailability } from '@camera/controls'

/**
 * The focus capability group of the driver contract (see `@camera/driver/contract`). Every vendor's
 * implementation lives in `@vendors/capabilities/focus`. A driver that cannot place a point or
 * drive the lens reports that through `availability` and throws CameraUnsupportedError.
 */

/**
 * - `acquired`: the camera reported focus.
 * - `not-acquired`: the camera reported it could not focus (low contrast, too dark, too close).
 * - `unknown`: the camera focused for a while but reports nothing either way (Canon's timed hold,
 *   Sony in movie mode).
 */
export type FocusResult = 'acquired' | 'not-acquired' | 'unknown'

export type FocusDirection = 'near' | 'far'

/** A small, medium or large manual-focus step, like the < << <<< buttons in vendor remote apps. */
export type FocusStepSize = 'small' | 'medium' | 'large'

export interface FocusPointOptions {
    /** Focus once at the point after moving it (default true). */
    autofocus: boolean
}

export type FocusOperationName = 'autofocus' | 'setFocusPoint' | 'resetFocusPoint' | 'nudgeFocus'

export interface FocusCapability {
    autofocus(): Promise<FocusResult>
    /** 0–1 from the top-left of the picture. */
    setFocusPoint(x: number, y: number, options: FocusPointOptions): Promise<void>
    /** Back to the centre and to the focus area and subject detection from before the point. Never refused. */
    resetFocusPoint(): Promise<void>
    nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void>
    /** Which focus operations this camera can do now, from an observation it already made (no reads). */
    availability(capabilities: CameraCapabilities): Record<FocusOperationName, OperationAvailability>
    /** A focus setting was written by the application; forget what a focus point had changed about it. */
    settingWritten(id: string): void
}
