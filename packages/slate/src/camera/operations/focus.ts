import { CanonCamera } from '@camera/canon-camera'
import type { Camera } from '@camera/index'
import { NikonCamera, type NikonFocusPointResult, type NikonFocusResult } from '@camera/nikon-camera'
import { canonDriver, cameraContext } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'

export interface FocusOperations {
    autofocus(durationMilliseconds?: number): Promise<void>
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

export const focusOperations: FocusOperations & ThisType<Camera> = {
    async autofocus(durationMilliseconds?: number): Promise<void> {
        const { driver } = cameraContext(this)
        if (driver instanceof NikonCamera) {
            await driver.autofocus(durationMilliseconds)
            return
        }
        if (!(driver instanceof CanonCamera) && !(driver instanceof SonyCamera)) {
            throw new Error('Standalone autofocus is only implemented for Canon EOS and Sony cameras')
        }
        return driver.autofocus(durationMilliseconds)
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
