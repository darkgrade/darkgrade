import type { CameraRecordingState } from '@camera/controls'

/**
 * The video capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * video slice owns this file and finalizes the result types when the operations land.
 */
export interface Clip {
    mediaId: string
    name: string
    sizeBytes?: number
}

export interface VideoCapability {
    /** Prepares the camera (video mode, card, audio), starts, and resolves once it reports recording. */
    startRecording(): Promise<void>
    /** Always allowed. Resolves once a finished clip is on the card and the camera is put back. */
    stopRecording(): Promise<Clip>
    /** Unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
}
