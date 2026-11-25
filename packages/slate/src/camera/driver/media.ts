/**
 * The media capability group of the driver contract (see `@camera/driver/contract`). A driver that
 * can do this provides it; one that cannot leaves it undefined, and Camera reports
 * CameraUnsupportedError with the reason. Signatures follow the plan's "The API" section; the
 * media slice owns this file and finalizes the result types when the operations land.
 */
export interface CardStatus {
    slot: number
    freeBytes?: number
    photosRemaining?: number
    recordingSecondsRemaining?: number
}

export interface MediaItem {
    /** Survives a reconnect. */
    id: string
    name: string
    kind: 'photo' | 'clip'
    sizeBytes?: number
}

export interface MediaCapability {
    getCardStatus(): Promise<CardStatus[]>
    /** Newest first. */
    listMedia(): Promise<MediaItem[]>
    getMediaPreview(id: string, size: 'thumbnail' | 'preview'): Promise<Uint8Array>
    downloadMedia(
        id: string,
        options: { onProgress?: (receivedBytes: number, totalBytes: number) => void; signal?: AbortSignal }
    ): Promise<Uint8Array>
}
