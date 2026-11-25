import type { CardStatus, MediaCapability, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver/media'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { SonyCamera, SonyPropertyState } from '@camera/sony-camera'
import { PTPResponseError } from '@core/ptp-errors'
import type { SonyContent, SonyContentFile } from '@vendors/sony/content-info-list'
import { encodeMediaId, decodeMediaId, mediaKind, newestFirst, type SonyContentMediaReference } from '@vendors/media/media-id'
import { OBJECT_SIZE_UNREPORTED, PtpObjectIndex, reportingRefusals } from '@vendors/media/ptp-object-index'
import { sonyPtpCardSlot, sonyPtpMovieMode } from '@vendors/sony/ptp-recording-card'

const OPERATION_NOT_SUPPORTED = 0x2005
const SLOTS = [1, 2] as const

/** Each card slot from Sony's property snapshot; Sony's PTP storage byte capacity is not card space. */
export function sonyCardStatus(properties: SonyPropertyState[]): CardStatus[] {
    const movieMode = sonyPtpMovieMode(properties)
    return SLOTS.map(slot => sonyPtpCardSlot(properties, slot, { movieMode }))
        .filter(card => card.code !== undefined)
        .map(card => ({
            slot: card.slot,
            state: card.status,
            ...(card.photos !== undefined && { photosRemaining: card.photos }),
            ...(card.seconds !== undefined && { recordingSecondsRemaining: card.seconds }),
        }))
}

/** Each card slot from the Sony Camera Remote SDK, whose slot status numbers native 1..9 as 0..8. */
export function sonySdkCardStatus(properties: { name: string; value: string }[]): CardStatus[] {
    const read = (name: string) => {
        const value = properties.find(property => property.name === name)?.value
        const number = value === undefined || value === '' ? NaN : Number(value)
        return Number.isSafeInteger(number) && number >= 0 && number < 0xffffffff ? number : undefined
    }
    return SLOTS.flatMap((slot): CardStatus[] => {
        const code = read(`MediaSLOT${slot}_Status`)
        if (code === undefined) return []
        const photos = read(`MediaSLOT${slot}_RemainingNumber`)
        // Zero time is also what still mode reports; only a positive time is evidence.
        const seconds = read(`MediaSLOT${slot}_RemainingTime`)
        return [{
            slot,
            state: code === 0 ? 'ready' : code === 1 ? 'absent' : code <= 8 ? 'error' : 'unknown',
            ...(photos !== undefined && { photosRemaining: photos }),
            ...(seconds !== undefined && seconds > 0 && { recordingSecondsRemaining: seconds }),
        }]
    })
}

function sonyItem(slot: 1 | 2, content: SonyContent, file: SonyContentFile): MediaItem {
    const name = file.path.split('/').pop() || file.path
    const kind = file.video ? 'clip' : mediaKind(name)
    const width = file.video?.width ?? file.width
    const height = file.video?.height ?? file.height
    return {
        id: encodeMediaId({
            source: 'sony-content',
            slot,
            contentId: content.contentId,
            fileId: file.fileId,
            name,
            sizeBytes: file.sizeBytes,
        }),
        name,
        kind,
        slot,
        sizeBytes: file.sizeBytes,
        // Sony stores the camera's local wall time as if it were UTC.
        ...(content.createdLocalMs > 0 && { capturedAt: new Date(content.createdLocalMs).toISOString().slice(0, 19) }),
        ...(width && height && { widthPixels: width, heightPixels: height }),
        previews: kind === 'other' ? [] : ['thumbnail', 'preview'],
    }
}

/** Slots whose card is ready; a body that reports no slot status still has its first slot read. */
async function readableSlots(driver: SonyCamera): Promise<(1 | 2)[]> {
    const cards = sonyCardStatus(await driver.refreshPropertyStates())
    const slots = SLOTS.filter(slot => cards.some(card => card.slot === slot && card.state === 'ready'))
    return slots.length || cards.length ? slots : [1]
}

/** One slot of Sony's card index; a body without one answers CameraUnsupportedError. */
async function listSlot(driver: SonyCamera, operation: string, slot: 1 | 2) {
    try {
        return await driver.listContents({ slot })
    } catch (error) {
        if (error instanceof PTPResponseError && error.code === OPERATION_NOT_SUPPORTED)
            throw new CameraUnsupportedError(operation, 'This camera does not offer its card index over USB')
        if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message)
        throw error
    }
}

/** The newest content id in each readable slot's card index (0 for an empty card). */
export type SonyCardIndexMark = Map<1 | 2, number>

/**
 * Where each readable slot's card index ends now, so a file added later can be told from an older
 * one of the same name (the camera's numbering wraps). Content ids grow with each capture. A body
 * that does not offer its card index answers CameraUnsupportedError.
 */
export async function markSonyCardIndex(driver: SonyCamera, operation: string): Promise<SonyCardIndexMark> {
    const mark: SonyCardIndexMark = new Map()
    for (const slot of await reportingRefusals(operation, () => readableSlots(driver))) {
        const { contents } = await listSlot(driver, operation, slot)
        mark.set(slot, contents.reduce((newest, content) => Math.max(newest, content.contentId), 0))
    }
    return mark
}

/**
 * The card file of a given name that the card index added after `mark`, as `listMedia()` lists
 * it. Undefined while no readable slot lists one.
 */
export async function findSonyCardFile(
    driver: SonyCamera,
    operation: string,
    name: string,
    mark: SonyCardIndexMark
): Promise<MediaItem | undefined> {
    for (const slot of await reportingRefusals(operation, () => readableSlots(driver))) {
        const after = mark.get(slot) ?? 0
        for (const content of (await listSlot(driver, operation, slot)).contents) {
            if (content.contentId <= after) continue
            const file = content.files.find(candidate => sonyItem(slot, content, candidate).name === name)
            if (file) return sonyItem(slot, content, file)
        }
    }
    return undefined
}

function contentReference(operation: string, id: string): SonyContentMediaReference {
    const reference = decodeMediaId(operation, id)
    if (reference.source !== 'sony-content')
        throw new CameraRefusedError(operation, `${reference.name} is not a file this camera listed`)
    return reference
}

/**
 * Sony card media. The list and previews come from the camera's own card index (Remote Control
 * with Transfer Mode), which needs no content-transfer mode, so live view keeps running. A
 * download enters content-transfer mode and finds the file's object handle by name; the next
 * live-view frame returns the body to shooting by itself (SonyCamera.returnToShooting).
 */
export function sonyMediaCapability(driver: SonyCamera): MediaCapability {
    const objects = new PtpObjectIndex(driver)

    return {
        getCardStatus: async () => reportingRefusals('getCardStatus', async () => sonyCardStatus(await driver.refreshPropertyStates())),

        async listMedia(): Promise<MediaItem[]> {
            const items: MediaItem[] = []
            const order = new Map<string, number>()
            for (const slot of await reportingRefusals('listMedia', () => readableSlots(driver))) {
                const list = await listSlot(driver, 'listMedia', slot)
                for (const content of list.contents)
                    for (const file of content.files) {
                        const item = sonyItem(slot, content, file)
                        // Content ids grow with each capture; files within a content keep their order.
                        order.set(item.id, content.contentId * 0x10000 - file.fileId)
                        items.push(item)
                    }
            }
            return newestFirst(items, item => order.get(item.id) ?? 0)
        },

        async getMediaPreview(id: string, size: MediaPreviewSize): Promise<Uint8Array> {
            const reference = contentReference('getMediaPreview', id)
            if (mediaKind(reference.name) === 'other')
                throw new CameraUnsupportedError('getMediaPreview', `The camera has no preview of ${reference.name}`)
            return reportingRefusals('getMediaPreview', async () => {
                try {
                    return await driver.getContentPreview(reference.contentId, reference.fileId, {
                        slot: reference.slot,
                        size: size === 'preview' ? 'screennail' : 'thumbnail',
                    })
                } catch (error) {
                    if (error instanceof Error && error.message === 'The camera returned no preview')
                        throw new CameraRefusedError('getMediaPreview', error.message)
                    throw error
                }
            })
        },

        async downloadMedia(id: string, options: MediaDownloadOptions): Promise<Uint8Array> {
            const reference = contentReference('downloadMedia', id)
            return reportingRefusals('downloadMedia', async () => {
                // Card enumeration and transfer require content-transfer mode.
                await driver.prepareStorageRead()
                const storages = (await objects.storageIds('downloadMedia')).filter(
                    storageId => storageId >>> 16 === reference.slot
                )
                const listed = await objects.list('downloadMedia', storages)
                // ObjectInfo holds 0xffffffff for originals over 4 GiB; the card index has the full size.
                const found = listed.find(
                    indexed =>
                        indexed.info.filename === reference.name &&
                        (indexed.info.objectCompressedSize === reference.sizeBytes ||
                            (indexed.info.objectCompressedSize === OBJECT_SIZE_UNREPORTED &&
                                reference.sizeBytes >= OBJECT_SIZE_UNREPORTED))
                )
                if (!found) throw new CameraRefusedError('downloadMedia', `${reference.name} is no longer on the card`)
                return driver.getObject(found.objectHandle, reference.sizeBytes, options.onProgress, options.signal)
            })
        },
    }
}
