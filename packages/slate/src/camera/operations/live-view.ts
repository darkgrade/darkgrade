import type { LiveViewFrame, LiveViewFrameOptions } from '@camera/driver/live-view'
import type { Camera } from '@camera/index'
import { requireCapability } from '@camera/operations/context'

export interface LiveViewOperations {
    /**
     * The current picture as a JPEG, with the camera's focus frames (0–1 from the top-left) and,
     * with `overlay`, the camera's on-screen info as a PNG to lay over it. Waits for the camera's
     * next frame first, so calling it in a loop never asks faster than the camera makes frames.
     */
    getLiveViewFrame(options?: LiveViewFrameOptions): Promise<LiveViewFrame>
}

export const liveViewOperations: LiveViewOperations & ThisType<Camera> = {
    async getLiveViewFrame(options: LiveViewFrameOptions = {}): Promise<LiveViewFrame> {
        return requireCapability(this, 'liveView', 'getLiveViewFrame').getLiveViewFrame({
            overlay: options.overlay === true,
        })
    },
}
