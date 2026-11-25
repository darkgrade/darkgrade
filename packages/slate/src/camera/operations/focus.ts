import type { CanonCamera } from '@camera/canon-camera'
import type { FocusDirection, FocusResult, FocusStepSize } from '@camera/driver/focus'
import type { Camera } from '@camera/index'
import { NikonCamera, type NikonFocusPointResult, type NikonFocusResult } from '@camera/nikon-camera'
import { canonDriver, cameraContext, requireCapability } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'

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
     * (Sony Wide, Zone, Center), Slate switches to a spot and pauses subject detection;
     * `resetFocusPoint` puts both back. `autofocus: false` only moves the point.
     */
    setFocusPoint(x: number, y: number, options?: { autofocus?: boolean }): Promise<void>
    /** Back to the centre and the focus area and subject detection from before. Never refused because of state. */
    resetFocusPoint(): Promise<void>
    /** Moves manual focus a small, medium or large step nearer or farther. */
    nudgeFocus(direction: FocusDirection, size: FocusStepSize): Promise<void>

    nikonAutofocus(timeoutMilliseconds?: number): Promise<NikonFocusResult>
    nikonTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<NikonFocusPointResult>
    nikonDriveFocus(direction: 'near' | 'far', steps?: number): ReturnType<NikonCamera['driveFocus']>
    sonyTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<{ x: number; y: number }>
    setSonyAfAreaPosition(x: number, y: number): Promise<void>
    setCanonLiveViewFramePoint(
        x: number,
        y: number,
        lockAfFrame?: boolean
    ): ReturnType<CanonCamera['setLiveViewFramePoint']>
}

function nikonDriver(camera: Camera, unavailable: string): NikonCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof NikonCamera)) throw new Error(unavailable)
    return driver
}

function sonyDriver(camera: Camera, unavailable: string): SonyCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof SonyCamera)) throw new Error(unavailable)
    return driver
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

    async nikonAutofocus(timeoutMilliseconds?: number): Promise<NikonFocusResult> {
        return nikonDriver(this, 'Nikon autofocus requires a Nikon camera').autofocus(timeoutMilliseconds)
    },

    async nikonTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<NikonFocusPointResult> {
        return nikonDriver(this, 'Nikon point focus requires a Nikon camera').touchFocus(x, y, options)
    },

    async nikonDriveFocus(direction: 'near' | 'far', steps?: number) {
        return nikonDriver(this, 'Nikon manual focus requires a Nikon camera').driveFocus(direction, steps)
    },

    async sonyTouchFocus(x: number, y: number, options?: { focus?: boolean }): Promise<{ x: number; y: number }> {
        return sonyDriver(this, 'Sony touch focus is only available for Sony cameras').touchFocus(x, y, options)
    },

    async setSonyAfAreaPosition(x: number, y: number): Promise<void> {
        return sonyDriver(this, 'Sony AF-area position is only available for Sony cameras').setAfAreaPosition(x, y)
    },

    async setCanonLiveViewFramePoint(x: number, y: number, lockAfFrame = false) {
        return canonDriver(this).setLiveViewFramePoint(x, y, lockAfFrame)
    },
}
