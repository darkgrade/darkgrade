import type { CameraRecordingState } from '@camera/controls'

/** A finished movie file the camera wrote to its card during one recording. */
export interface Clip {
    /** The card object's id on this connection (its PTP object handle, in decimal). */
    mediaId: string
    /** The file name on the card, such as `C0001.MP4`. */
    name: string
    /** Bytes on the card; absent when the camera reports a size it cannot state (over 4 GiB). */
    sizeBytes?: number
}

/**
 * The video capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can record provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError. Each command is sent once: confirmation polls the camera's own
 * recording state and never replays Record or Stop.
 */
export interface VideoCapability {
    /**
     * Prepares the camera (video mode, card destination, audio), checks the card, starts, and
     * resolves once the camera reports recording. A refused start puts the camera back; an
     * unconfirmed one keeps the prepared mode so Stop stays available.
     */
    startRecording(): Promise<void>
    /**
     * Always allowed. Sends Stop once, confirms idle, waits for the new finished clip on the card,
     * then puts the camera back. Called again after a failed restore, it retries only the restore.
     */
    stopRecording(): Promise<Clip>
    /** What the camera reports now; unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
}
