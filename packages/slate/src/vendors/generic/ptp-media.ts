import type { CardStatus, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver'
import type { MediaCapability } from '@vendors/generic/capability-groups'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { CameraDriverInstance } from '@camera/camera-context'
import { readCameraStorages } from '@vendors/generic/storage'
import { PTPError } from '@core/ptp-errors'
import { GetThumb } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { decodeMediaId, newestFirst, type ObjectMediaReference } from '@vendors/generic/media-id'
import {
    OBJECT_SIZE_UNREPORTED,
    PtpObjectIndex,
    reportingRefusals,
    type IndexedObject,
} from '@vendors/generic/ptp-object-index'
import { readNikonObjectSize } from '@vendors/nikon/object-size'

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
        slot: storage.storageId >>> 16,
        state: 'ready',
        writable: storage.writable,
        ...(storage.capacityBytes > 0 && { capacityBytes: storage.capacityBytes, freeBytes: storage.freeBytes }),
        ...(storage.freeImages !== undefined && storage.freeImages !== NO_IMAGE_COUNT && { photosRemaining: storage.freeImages }),
    }))
}

/** The full size of an object, using the vendor's 64-bit query when ObjectInfo cannot hold it. */
async function objectSize(owner: Camera, driver: CameraDriverInstance, indexed: IndexedObject): Promise<number> {
    const reported = indexed.info.objectCompressedSize
    if (reported !== OBJECT_SIZE_UNREPORTED) return reported
    if (driver instanceof NikonCamera) {
        try {
            return await readNikonObjectSize(owner, indexed.objectHandle, reported)
        } catch (error) {
            // Transport, timeout and response errors pass through; the size check's own refusal is the camera's.
            if (error instanceof PTPError || !(error instanceof Error)) throw error
            throw new CameraRefusedError('downloadMedia', error.message)
        }
    }
    throw new CameraUnsupportedError(
        'downloadMedia',
        `${indexed.item.name} is larger than 4 GiB and this camera does not report its full size; copy it from the card`
    )
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
            return newestFirst(
                objects.map(indexed => indexed.item),
                item => order.get(item.id) ?? 0
            )
        },

        async getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array> {
            const reference = objectReference('getMediaPreview', id)
            if (size !== 'thumbnail')
                throw new CameraUnsupportedError(
                    'getMediaPreview',
                    'This camera only offers thumbnails; download the file for a larger picture'
                )
            const indexed = await reportingRefusals('getMediaPreview', () => index.resolve('getMediaPreview', reference))
            if (!indexed.item.previews.includes('thumbnail'))
                throw new CameraUnsupportedError('getMediaPreview', `The camera has no thumbnail of ${reference.name}`)
            const response = await driver.send(GetThumb, { ObjectHandle: indexed.objectHandle })
            if (response.code !== OK.code)
                throw new CameraRefusedError('getMediaPreview', `The camera refused the thumbnail (0x${response.code.toString(16)})`)
            if (!(response.data instanceof Uint8Array) || response.data.length === 0)
                throw new CameraRefusedError('getMediaPreview', 'The camera returned an empty thumbnail')
            return response.data
        },

        async downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array> {
            const reference = objectReference('downloadMedia', id)
            return reportingRefusals('downloadMedia', async () => {
                const indexed = await index.resolve('downloadMedia', reference)
                const size = await objectSize(owner, driver, indexed)
                return driver.getObject(indexed.objectHandle, size, options.onProgress, options.signal)
            })
        },

        async availability() {
            const thumbnails = await reportingRefusals('getMediaPreview', () => index.thumbnailsSupported('getMediaPreview'))
            return thumbnails
                ? {}
                : { getMediaPreview: { supported: false, reason: 'This camera does not offer thumbnails of its card files' } }
        },
    }
}
