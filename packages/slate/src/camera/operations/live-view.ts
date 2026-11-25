import type { LiveViewFrame, LiveViewFrameOptions } from '@camera/driver/live-view'
import type { Camera } from '@camera/index'
import type { NikonLiveViewMetadata } from '@camera/nikon-camera'
import { canonDriver, cameraContext, requireCapability } from '@camera/operations/context'
import { SonyCamera, type SonyOsdImage } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { CanonLiveViewFrame } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import type { SonyFocalFrame } from '@vendors/sony/focal-frame-info'

export interface LiveViewOperations {
    /**
     * The current picture as a JPEG, with the camera's focus frames (0–1 from the top-left) and,
     * with `overlay`, the camera's on-screen info as a PNG to lay over it. Waits for the camera's
     * next frame first, so calling it in a loop never asks faster than the camera makes frames.
     */
    getLiveViewFrame(options?: LiveViewFrameOptions): Promise<LiveViewFrame>
    captureLiveView(params?: { includeInfo?: boolean; includeData?: boolean }): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
        nikonMetadata?: NikonLiveViewMetadata
        sonyFocalFrames?: SonyFocalFrame[]
    }>
    /** Milliseconds until the camera's next live-view frame is due; 0 when unknown or not a Sony body. */
    millisecondsUntilNextLiveViewFrame(): number
    /** Live-view requests and frames since the last call (Sony), for measuring polling cost. */
    takeLiveViewStatistics(): { requests: number; refusals: number; frames: number } | null
    captureCanonViewfinderFrame(): Promise<CanonLiveViewFrame>
    stopCanonLiveView(): Promise<void>
    /** Turns the camera's on-screen display stream on or off; captureSonyOsdImage turns it on by itself. */
    setSonyOsdImageMode(enabled: boolean): Promise<void>
    captureSonyOsdImage(): Promise<SonyOsdImage>
    getCanonHdmiLiveViewMode(): Promise<string>
    setCanonHdmiLiveViewMode(value: string): Promise<void>
}

function sonyOsdDriver(camera: Camera): SonyCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof SonyCamera)) throw new Error('Sony OSD image is only available for Sony cameras')
    return driver
}

const canonHdmiUnavailable = 'Canon HDMI live-view mode is only available for Canon EOS cameras'

export const liveViewOperations: LiveViewOperations & ThisType<Camera> = {
    async getLiveViewFrame(options: LiveViewFrameOptions = {}): Promise<LiveViewFrame> {
        return requireCapability(this, 'liveView', 'getLiveViewFrame').getLiveViewFrame({
            overlay: options.overlay === true,
        })
    },

    async captureLiveView(params?: { includeInfo?: boolean; includeData?: boolean }) {
        return cameraContext(this).driver.captureLiveView({ includeInfo: true, includeData: true, ...params })
    },

    millisecondsUntilNextLiveViewFrame(): number {
        const { driver } = cameraContext(this)
        return driver instanceof SonyCamera ? driver.millisecondsUntilNextLiveViewFrame() : 0
    },

    takeLiveViewStatistics(): { requests: number; refusals: number; frames: number } | null {
        const { driver } = cameraContext(this)
        return driver instanceof SonyCamera ? driver.takeLiveViewStatistics() : null
    },

    async captureCanonViewfinderFrame(): Promise<CanonLiveViewFrame> {
        return canonDriver(this).captureViewfinderFrame()
    },

    async stopCanonLiveView(): Promise<void> {
        await canonDriver(this).stopLiveView()
    },

    async setSonyOsdImageMode(enabled: boolean): Promise<void> {
        return sonyOsdDriver(this).setOsdImageMode(enabled)
    },

    async captureSonyOsdImage(): Promise<SonyOsdImage> {
        return sonyOsdDriver(this).captureOsdImage()
    },

    async getCanonHdmiLiveViewMode(): Promise<string> {
        return canonDriver(this, canonHdmiUnavailable).getHdmiLiveViewMode()
    },

    async setCanonHdmiLiveViewMode(value: string): Promise<void> {
        return canonDriver(this, canonHdmiUnavailable).setHdmiLiveViewMode(value)
    },
}
