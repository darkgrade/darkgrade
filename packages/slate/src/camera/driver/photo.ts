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
     * The card file, as `<capture date>/<file name>` from its object information, or the file name
     * alone when the camera reports no capture date (Sony): the same on every connection, so it
     * still names the file after a reconnect.
     */
    mediaId: string
    /** The file name the camera gave the photo, such as `DSC01234.JPG`. */
    name: string
    /**
     * The size of the file the camera described. Sony describes the copy it sends the computer,
     * which is smaller than the card original when the body's PC save size is reduced.
     */
    sizeBytes: number
}

/** A photo confirmed on the card whose bytes also reached this computer. */
export interface ComputerPhoto extends Omit<CardPhoto, 'destination'> {
    destination: 'computer'
    data: Uint8Array
}

export type Photo = CardPhoto | ComputerPhoto

/** What a driver confirms for one release: the new file's object information, and its bytes when asked. */
export interface ConfirmedPhotoFile {
    filename: string
    captureDate: string
    objectCompressedSize: number
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
