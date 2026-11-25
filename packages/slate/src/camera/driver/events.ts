/**
 * The events capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * events slice owns this file and finalizes the result types when the operations land.
 */
export type CameraEventName = 'settingsChanged' | 'mediaAdded'

export interface EventsCapability {
    /** Resolves nothing; returns the function that stops listening. */
    subscribe(event: CameraEventName, handler: () => void): () => void
}
