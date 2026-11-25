import type { OperationAvailability } from '@camera/controls'
/**
 * The media capability group of the driver contract (see `@camera/driver/contract`): card status,
 * the card's photos and clips, their previews and their bytes. A driver that can do this provides
 * it; one that cannot leaves it undefined, and Camera reports CameraUnsupportedError.
 */

/** One card slot as the camera reports it now. A field the camera does not report is absent. */
export interface CardStatus {
    /** 1 for the first slot. */
    slot: number
    /** `ready`: a card is in and readable. `unknown`: the camera did not say. */
    state: 'ready' | 'absent' | 'error' | 'unknown'
    /** Whether the camera says it can record to this card; absent when it does not say. */
    writable?: boolean
    capacityBytes?: number
    freeBytes?: number
    photosRemaining?: number
    recordingSecondsRemaining?: number
}

export type MediaPreviewSize = 'thumbnail' | 'preview'

export interface MediaItem {
    /** Opaque; survives a reconnect while the file stays on the card. */
    id: string
    /** The file name on the card, such as `DSC01234.ARW`. */
    name: string
    kind: 'photo' | 'clip' | 'other'
    slot: number
    sizeBytes?: number
    /** The camera's local wall time, ISO 8601 without an offset (`2026-11-24T14:05:09`). */
    capturedAt?: string
    widthPixels?: number
    heightPixels?: number
    /** The preview sizes `getMediaPreview` can return for this file. */
    previews: readonly MediaPreviewSize[]
}

export interface MediaDownloadOptions {
    /** Called after each chunk with the bytes received so far. */
    onProgress?: (receivedBytes: number, totalBytes: number) => void
    /** Cancels between chunks; the download rejects with the signal's reason. */
    signal?: AbortSignal
}

export interface MediaCapability {
    getCardStatus(): Promise<CardStatus[]>
    /** Newest first. */
    listMedia(): Promise<MediaItem[]>
    /** A JPEG of a photo or clip. */
    getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array>
    downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array>
    /** Operations this driver has but cannot do right now, with the reason. */
    availability?(): Promise<Partial<Record<MediaOperationName, OperationAvailability>>>
}

export type MediaOperationName = 'getCardStatus' | 'listMedia' | 'getMediaPreview' | 'downloadMedia'
