/**
 * The events capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError.
 */

/** `settingsChanged`: a setting changed on the camera. `mediaAdded`: a new photo or clip is on the card. */
export type CameraEventName = 'settingsChanged' | 'mediaAdded'

export type CameraEventHandler = () => void

export interface EventsCapability {
    /** Starts delivering the event to `handler`; returns the function that stops it. */
    subscribe(event: CameraEventName, handler: CameraEventHandler): () => void
}
