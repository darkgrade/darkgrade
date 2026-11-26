import type { CameraCapabilities, CameraRecordingState, OperationAvailability } from '@camera/controls'
import type { CardStatus, Clip, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver'

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

export interface MediaCapability {
    getCardStatus(): Promise<CardStatus[]>
    /** Newest first. */
    listMedia(): Promise<MediaItem[]>
    /** A JPEG of a photo or clip. */
    getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array>
    downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array>
    /** Operations this driver has but cannot do right now, with the reason, judged from this observation. */
    availability?(
        capabilities: CameraCapabilities
    ): Promise<Partial<Record<'getCardStatus' | 'listMedia' | 'getMediaPreview' | 'downloadMedia', OperationAvailability>>>
}

