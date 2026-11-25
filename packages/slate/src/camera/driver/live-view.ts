/**
 * The live-view capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * live-view slice owns this file and finalizes the result types when the operations land.
 */
export interface FocusFrame {
    /** 0–1 from the top-left of the picture. */
    x: number
    y: number
    width: number
    height: number
    focused: boolean
}

export interface LiveViewFrame {
    jpeg: Uint8Array
    focusFrames: FocusFrame[]
}

export interface LiveViewCapability {
    getLiveViewFrame(options: { overlay: boolean }): Promise<LiveViewFrame>
}
