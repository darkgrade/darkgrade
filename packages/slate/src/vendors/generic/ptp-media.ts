import type { CameraCapabilities } from '@camera/controls'
import type { CardStatus, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver'
import type { MediaCapability } from '@vendors/generic/capability-groups'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/camera-context'
import { readCameraStorages } from '@vendors/generic/storage'
import { GetThumb } from '@ptp/definitions/operation-definitions'
import { completePreview } from '@vendors/generic/jpeg-end'
import { OK } from '@ptp/definitions/response-definitions'
import { operationsAdvertised } from '@vendors/generic/generic-operations'
import { decodeMediaId, newestFirst, type ObjectMediaReference } from '@vendors/generic/media-id'
import { PtpObjectIndex, reportingRefusals, type IndexedObject } from '@vendors/generic/ptp-object-index'

const NO_IMAGE_COUNT = 0xffffffff

function objectReference(operation: string, id: string): ObjectMediaReference {
    const reference = decodeMediaId(operation, id)
    if (reference.source !== 'object')
        throw new CameraRefusedError(operation, `${reference.name} is not a file this camera listed`)
    return reference
}

/** Card space from each populated storage's StorageInfo (standard PTP bodies: Canon, Nikon and others). */
export async function readStorageCardStatus(owner: Camera): Promise<CardStatus[]> {
    const storages = await readCameraStorages(owner)
    return storages.map((storage): CardStatus => ({
        slot: storage.slot,
        state: 'ready',
        writable: storage.writable,
        ...(storage.capacityBytes > 0 && { capacityBytes: storage.capacityBytes, freeBytes: storage.freeBytes }),
        ...(storage.freeImages !== undefined && storage.freeImages !== NO_IMAGE_COUNT && { photosRemaining: storage.freeImages }),
    }))
}

/** The full size of an object, using the driver's 64-bit query when ObjectInfo cannot hold it. */
async function objectSize(driver: CameraDriverInstance, indexed: IndexedObject): Promise<number> {
    const reported = indexed.info.objectCompressedSize
    try {
        return await driver.fullObjectSize(indexed.objectHandle, reported)
    } catch (error) {
        if (!(error instanceof CameraUnsupportedError)) throw error
        throw new CameraUnsupportedError(
            'downloadMedia',
            `${indexed.item.name} is larger than 4 GiB and this camera does not report its full size; copy it from the card`
        )
    }
}

/**
 * Card media through standard PTP object handles: StorageInfo for space, ObjectInfo for the list,
 * GetThumb for thumbnails and the driver's own chunked transfer for downloads.
 */
export function ptpMediaCapability(driver: CameraDriverInstance, owner: Camera): MediaCapability {
    const index = new PtpObjectIndex(driver)
    return {
        getCardStatus: () => reportingRefusals('getCardStatus', () => readStorageCardStatus(owner)),

        async listMedia(): Promise<MediaItem[]> {
            const objects = await reportingRefusals('listMedia', () => index.list('listMedia'))
            const order = new Map(objects.map(indexed => [indexed.item.id, indexed.objectHandle]))
            return newestFirst(objects.map(indexed => indexed.item), item => order.get(item.id) ?? 0)
        },

        async getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array> {
            const reference = objectReference('getMediaPreview', id)
            if (size !== 'thumbnail')
                throw new CameraUnsupportedError('getMediaPreview', 'This camera only offers thumbnails; download the file for a larger picture')
            const indexed = await reportingRefusals('getMediaPreview', () => index.resolve('getMediaPreview', reference))
            if (!indexed.item.previews.includes('thumbnail'))
                throw new CameraUnsupportedError('getMediaPreview', `The camera has no thumbnail of ${reference.name}`)
            const response = await driver.send(GetThumb, { ObjectHandle: indexed.objectHandle })
            if (response.code !== OK.code)
                throw new CameraRefusedError('getMediaPreview', `The camera refused the thumbnail (0x${response.code.toString(16)})`)
            if (!(response.data instanceof Uint8Array) || response.data.length === 0)
                throw new CameraRefusedError('getMediaPreview', 'The camera returned an empty thumbnail')
            return completePreview(response.data)
        },

        async downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array> {
            const reference = objectReference('downloadMedia', id)
            return reportingRefusals('downloadMedia', async () => {
                const indexed = await index.resolve('downloadMedia', reference)
                const size = await objectSize(driver, indexed)
                return driver.getObject(indexed.objectHandle, size, options.onProgress, options.signal)
            })
        },

        /** The standard operations these paths send, as the body's DeviceInfo advertises them. */
        async availability(capabilities: CameraCapabilities) {
            const { GetStorageIDs, GetStorageInfo, GetObjectHandles, GetObjectInfo } = driver.registry.operations
            const cards = operationsAdvertised(capabilities, [GetStorageIDs, GetStorageInfo])
            const files = operationsAdvertised(capabilities, [GetStorageIDs, GetObjectHandles, GetObjectInfo])
            const availability: Awaited<ReturnType<NonNullable<MediaCapability['availability']>>> = {}
            if (!cards.supported) availability.getCardStatus = cards
            if (!files.supported) return { ...availability, listMedia: files, getMediaPreview: files, downloadMedia: files }
            const thumbnails = await reportingRefusals('getMediaPreview', () => index.thumbnailsSupported('getMediaPreview'))
            if (!thumbnails)
                availability.getMediaPreview = { supported: false, reason: 'This camera does not offer thumbnails of its card files' }
            return availability
        },
    }
}
