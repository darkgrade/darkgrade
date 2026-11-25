/**
 * The zoom capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * zoom slice owns this file and finalizes the result types when the operations land.
 */
export interface ZoomCapability {
    /** Resolves to the focal length, in millimetres, where the lens landed. */
    zoomTo(focalLengthMillimetres: number): Promise<number>
    startZoom(direction: 'in' | 'out', options: { speed: 'slow' | 'medium' | 'fast' }): Promise<void>
    /** Always allowed. */
    stopZoom(): Promise<void>
}
