/**
 * The photo capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can take a photo provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason.
 */

/** Where a photo goes: the camera's card, or the card and this computer (its bytes come back). */
export type PhotoDestination = 'card' | 'computer'

export interface TakePhotoOptions {
    /** Default true: focus before the shutter. False releases without waiting for focus. */
    autofocus?: boolean
    /** Default 'card'. With 'computer' the photo is still saved to the card, and its bytes are returned. */
    destination?: PhotoDestination
}

/** A photo confirmed on the card. */
export interface CardPhoto {
    destination: 'card'
    /**
     * The card file's media id, the same id `listMedia()` gives it, for `getMediaPreview()` and
     * `downloadMedia()`. Absent only when the camera offers no card listing over this connection
     * (`listMedia` is unsupported), so no id can name the file.
     */
    mediaId?: string
    /** The file name the camera gave the photo, such as `DSC01234.JPG`. */
    name: string
    /** The size of the card file, as `listMedia()` reports it. */
    sizeBytes: number
}

/**
 * A photo confirmed on the card whose bytes also reached this computer. On Sony the bytes are the
 * copy the camera sends the computer, which is smaller than the card file when the body's PC save
 * size is reduced; `downloadMedia(mediaId)` reads the card file itself.
 */
export interface ComputerPhoto extends Omit<CardPhoto, 'destination'> {
    destination: 'computer'
    data: Uint8Array
}

export type Photo = CardPhoto | ComputerPhoto

/** What a driver confirms for one release: the new card file, and its bytes when asked. */
export interface ConfirmedPhotoFile {
    mediaId?: string
    name: string
    sizeBytes: number
    data?: Uint8Array
}

export interface PhotoCapability {
    /**
     * One shutter release, resolved only once the camera shows the new file on its card. Photo or
     * video mode preparation happens inside and is undone afterwards. An unconfirmed release is
     * reported as CameraOutcomeUnknownError and never repeated; a release the camera refuses is
     * CameraRefusedError.
     */
    takePhoto(options: { autofocus: boolean; destination: PhotoDestination }): Promise<ConfirmedPhotoFile>
}
