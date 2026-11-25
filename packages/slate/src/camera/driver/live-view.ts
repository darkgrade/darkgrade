import type { OperationSupport } from '@camera/controls'

/** A frame the camera draws over its picture: its focus area, a detected face or a tracked subject. */
export interface FocusFrame {
    kind: 'focus' | 'face' | 'tracking'
    /** True once the camera reports this frame in focus. */
    focused: boolean
    /** Centre and size as fractions of the picture, 0–1 from the top-left. */
    centerX: number
    centerY: number
    width: number
    height: number
}

/** The camera's own on-screen info (menus, dialogs, shooting info), drawn to lay over the picture. */
export interface LiveViewOverlay {
    /** A PNG with transparency, the size of the camera's display. */
    png: Uint8Array
}

export interface LiveViewFrame {
    /** The current picture as a JPEG. */
    jpeg: Uint8Array
    focusFrames: FocusFrame[]
    /** Present when the overlay was requested. */
    overlay?: LiveViewOverlay
}

export interface LiveViewFrameOptions {
    /** Also read the camera's on-screen info. */
    overlay?: boolean
}

/**
 * The live-view capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can stream its picture provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError. Pacing (waiting for the camera's next frame) and switching the overlay
 * output on and off happen inside the capability.
 */
export interface LiveViewCapability {
    getLiveViewFrame(options: { overlay: boolean }): Promise<LiveViewFrame>
    /** Support from the camera's latest observation, including the overlay option; sends nothing. */
    support(): Record<'getLiveViewFrame', OperationSupport>
}
