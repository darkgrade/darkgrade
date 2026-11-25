import type { Camera } from '@camera/index'
import { cameraContext } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { StorageInfo } from '@ptp/datasets/storage-info-dataset'

export interface MediaOperations {
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
