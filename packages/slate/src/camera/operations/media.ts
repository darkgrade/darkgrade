import type { CardStatus, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver/media'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { requireCapability } from '@camera/operations/context'

export interface MediaOperations {
    /** Per card slot: free space, photos left and recording time left, as the camera reports them now. */
    getCardStatus(): Promise<CardStatus[]>
    /** Photos and clips on the card, newest first, with ids that survive a reconnect. */
    listMedia(): Promise<MediaItem[]>
    /** A JPEG of a photo or clip; `item.previews` lists the sizes this camera offers for it. */
    getMediaPreview(id: string, size?: MediaPreviewSize): Promise<Uint8Array>
    /** Copies a file off the card, with progress and cancel. Never deletes or changes the card. */
    downloadMedia(id: string, options?: MediaDownloadOptions): Promise<Uint8Array>
}

export const mediaOperations: MediaOperations & ThisType<Camera> = {
    async getCardStatus(): Promise<CardStatus[]> {
        return requireCapability(this, 'media', 'getCardStatus').getCardStatus()
    },

    async listMedia(): Promise<MediaItem[]> {
        return requireCapability(this, 'media', 'listMedia').listMedia()
    },

    async getMediaPreview(id: string, size: MediaPreviewSize = 'thumbnail'): Promise<Uint8Array> {
        if (size !== 'thumbnail' && size !== 'preview')
            throw new CameraRefusedError('getMediaPreview', `Preview size must be thumbnail or preview, not ${String(size)}`)
        return requireCapability(this, 'media', 'getMediaPreview').getMediaPreview(id, size)
    },

    async downloadMedia(id: string, options: MediaDownloadOptions = {}): Promise<Uint8Array> {
        return requireCapability(this, 'media', 'downloadMedia').downloadMedia(id, options)
    },
}
