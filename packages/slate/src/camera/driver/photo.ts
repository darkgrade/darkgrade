/**
 * The photo capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * photo slice owns this file and finalizes the result types when the operations land.
 */
export interface Photo {
    mediaId: string
    name: string
    sizeBytes: number
    /** Present for destination 'computer'. */
    data?: Uint8Array
}

export interface PhotoCapability {
    /** Resolves only once a new file is confirmed; an unconfirmed release is never repeated. */
    takePhoto(options: { autofocus: boolean; destination: 'card' | 'computer' }): Promise<Photo>
}
