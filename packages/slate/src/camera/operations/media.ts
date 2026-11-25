import type { CardStatus, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver/media'
import { CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { cameraContext, requireCapability } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { StorageInfo } from '@ptp/datasets/storage-info-dataset'

export interface MediaOperations {
    /** Per card slot: free space, photos left and recording time left, as the camera reports them now. */
    getCardStatus(): Promise<CardStatus[]>
    /** Photos and clips on the card, newest first, with ids that survive a reconnect. */
    listMedia(): Promise<MediaItem[]>
    /** A JPEG of a photo or clip; `item.previews` lists the sizes this camera offers for it. */
    getMediaPreview(id: string, size?: MediaPreviewSize): Promise<Uint8Array>
    /** Copies a file off the card, with progress and cancel. Never deletes or changes the card. */
    downloadMedia(id: string, options?: MediaDownloadOptions): Promise<Uint8Array>
    listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }>
    /** Downloads an object; onProgress reports bytes received after each chunk. */
    getObject(
        objectHandle: number,
        objectSize: number,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array>
    /** Sony: the card's contents without entering content-transfer mode (live view keeps running). */
    listSonyContents(options?: { slot?: 1 | 2; limit?: number; sinceUtcMs?: number }): ReturnType<
        SonyCamera['listContents']
    >
    /** Sony: a content's JPEG thumbnail or screennail. */
    getSonyContentPreview(
        contentId: number,
        fileId: number,
        options?: { slot?: 1 | 2; size?: 'thumbnail' | 'screennail' }
    ): Promise<Uint8Array>
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

    async listObjects() {
        return cameraContext(this).driver.listObjects()
    },

    async getObject(
        objectHandle: number,
        objectSize: number,
        onProgress?: (receivedBytes: number, totalBytes: number) => void,
        signal?: AbortSignal
    ): Promise<Uint8Array> {
        return cameraContext(this).driver.getObject(objectHandle, objectSize, onProgress, signal)
    },

    async listSonyContents(options?: { slot?: 1 | 2; limit?: number; sinceUtcMs?: number }) {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) throw new Error('Sony content listing is only available for Sony cameras')
        return driver.listContents(options)
    },

    async getSonyContentPreview(
        contentId: number,
        fileId: number,
        options?: { slot?: 1 | 2; size?: 'thumbnail' | 'screennail' }
    ): Promise<Uint8Array> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera))
            throw new Error('Sony content previews are only available for Sony cameras')
        return driver.getContentPreview(contentId, fileId, options)
    },
}
