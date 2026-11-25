/**
 * The focus capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * focus slice owns this file and finalizes the result types when the operations land.
 */
export type FocusResult = 'acquired' | 'not-acquired' | 'unknown'

export interface FocusCapability {
    autofocus(): Promise<FocusResult>
    /** 0–1 from the top-left of the picture. */
    setFocusPoint(x: number, y: number, options: { autofocus: boolean }): Promise<void>
    resetFocusPoint(): Promise<void>
    nudgeFocus(direction: 'near' | 'far', size: 'small' | 'medium' | 'large'): Promise<void>
}
