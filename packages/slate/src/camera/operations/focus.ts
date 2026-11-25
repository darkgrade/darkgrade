import type { FocusDirection, FocusResult, FocusStepSize } from '@camera/driver/focus'
import type { Camera } from '@camera/index'
import { cameraContext, requireCapability } from '@camera/operations/context'

export interface FocusOperations {
    /**
     * Focuses once with the camera's own focus area and says whether the camera confirmed focus:
     * `acquired`, `not-acquired`, or `unknown` when the camera reports nothing either way (Canon's
     * timed hold, Sony in movie mode). Errors: CameraUnsupportedError, CameraRefusedError,
     * CameraOutcomeUnknownError.
     */
    autofocus(): Promise<FocusResult>
    /**
     * Focuses on a point in the picture, 0–1 from the top-left. Where the focus area has no position
     * (Sony Wide, Zone, Center), Slate switches to a spot; on Sony it also pauses subject detection so
     * eye tracking does not pull focus back to a face. `resetFocusPoint` puts both back. An area
     * chosen with a setter since the point stays. `autofocus: false` only moves the point.
     */
    setFocusPoint(x: number, y: number, options?: { autofocus?: boolean }): Promise<void>
    /** Back to the centre and the focus area and subject detection from before. Never refused because of state. */
    resetFocusPoint(): Promise<void>
    /** Moves manual focus a small, medium or large step nearer or farther. */
    nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void>

}

/** Focus operations write camera state, so they take turns with setting writes and recording. */
function onCameraQueue<T>(camera: Camera, operation: () => Promise<T>): Promise<T> {
    return cameraContext(camera).controlsQueue.run('camera', operation)
}

export const focusOperations: FocusOperations & ThisType<Camera> = {
    async autofocus(): Promise<FocusResult> {
        const focus = requireCapability(this, 'focus', 'autofocus')
        return onCameraQueue(this, () => focus.autofocus())
    },

    async setFocusPoint(x: number, y: number, options: { autofocus?: boolean } = {}): Promise<void> {
        const focus = requireCapability(this, 'focus', 'setFocusPoint')
        const autofocus = options.autofocus ?? true
        return onCameraQueue(this, () => focus.setFocusPoint(x, y, { autofocus }))
    },

    async resetFocusPoint(): Promise<void> {
        const focus = requireCapability(this, 'focus', 'resetFocusPoint')
        return onCameraQueue(this, () => focus.resetFocusPoint())
    },

    async nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void> {
        const focus = requireCapability(this, 'focus', 'nudgeFocus')
        return onCameraQueue(this, () => focus.nudgeFocus(direction, size))
    },
}
