import { CameraRefusedError } from '@camera/errors'
import type { MediaItem } from '@camera/driver'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { PTPResponseError } from '@core/ptp-errors'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { cardSlotNumbers } from '@vendors/generic/media-id'
import { GetDeviceInfo, GetObjectHandles, GetObjectInfo, GetStorageIDs, GetThumb } from '@ptp/definitions/operation-definitions'
import { OK } from '@ptp/definitions/response-definitions'
import { encodeMediaId, mediaKind, ptpDateToIso, type ObjectMediaReference } from '@vendors/generic/media-id'

/** ObjectInfo's 32-bit size field holds this when the real size needs a 64-bit query. */
export const OBJECT_SIZE_UNREPORTED = 0xffffffff
const ASSOCIATION_FORMAT = 0x3001

export interface IndexedObject {
    storageId: number
    objectHandle: number
    info: ObjectInfo
    item: MediaItem
}

type ObjectDriver = Pick<GenericCamera, 'send' | 'sessionId'>

function refused(operation: string, action: string, code: number): CameraRefusedError {
    return new CameraRefusedError(operation, `The camera refused ${action} (0x${code.toString(16)})`)
}

/**
 * Runs one media read, reporting the camera's refusal (a PTP response other than OK) as
 * CameraRefusedError. Transport failures, timeouts and disconnects pass through unchanged, so a
 * host still sees that the session needs a reconnect.
 */
export async function reportingRefusals<Result>(operation: string, work: () => Promise<Result>): Promise<Result> {
    try {
        return await work()
    } catch (error) {
        if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message)
        throw error
    }
}

/**
 * The card's objects through standard PTP handles, for one session at a time. Handles are stable
 * within a PTP session, so each object's info is read once per session; a new session (a
 * reconnect, or Sony leaving playback) starts over.
 */
export class PtpObjectIndex {
    private sessionId: number | null = null
    private objects = new Map<number, IndexedObject | null>()
    /** Each storage's card slot, from the last GetStorageIDs. */
    private slots = new Map<number, number>()
    private thumbnailsAdvertised?: boolean

    constructor(private readonly driver: ObjectDriver) {}

    private currentSession(): void {
        if (this.driver.sessionId === this.sessionId) return
        this.sessionId = this.driver.sessionId
        this.objects.clear()
        this.thumbnailsAdvertised = undefined
    }

    /** Whether DeviceInfo advertises GetThumb; read once per session. */
    async thumbnailsSupported(operation: string): Promise<boolean> {
        this.currentSession()
        if (this.thumbnailsAdvertised === undefined) {
            const response = await this.driver.send(GetDeviceInfo, {})
            if (response.code !== OK.code || !response.data) throw refused(operation, 'its device information', response.code)
            this.thumbnailsAdvertised = response.data.operationsSupportedRaw.includes(GetThumb.code)
        }
        return this.thumbnailsAdvertised
    }

    /** Populated storages; an empty-slot placeholder (low word zero) is not a readable card. */
    async storageIds(operation: string): Promise<number[]> {
        const response = await this.driver.send(GetStorageIDs, {})
        if (response.code !== OK.code || !Array.isArray(response.data))
            throw refused(operation, 'to list its cards', response.code)
        this.slots = cardSlotNumbers(response.data)
        return response.data.filter(storageId => (storageId & 0xffff) !== 0)
    }

    /** Every file on the given storages (all populated ones by default); folders are left out. */
    async list(operation: string, storageIds?: number[]): Promise<IndexedObject[]> {
        this.currentSession()
        const thumbnails = await this.thumbnailsSupported(operation)
        const listed: IndexedObject[] = []
        for (const storageId of storageIds ?? (await this.storageIds(operation))) {
            const response = await this.driver.send(GetObjectHandles, { StorageID: storageId })
            if (response.code !== OK.code || !Array.isArray(response.data))
                throw refused(operation, 'to list the files on its card', response.code)
            const present = new Set(response.data)
            for (const [objectHandle, indexed] of this.objects)
                if (indexed?.storageId === storageId && !present.has(objectHandle)) this.objects.delete(objectHandle)
            for (const objectHandle of response.data) {
                if (!this.objects.has(objectHandle))
                    this.objects.set(objectHandle, await this.readObject(storageId, objectHandle, thumbnails))
                const indexed = this.objects.get(objectHandle)
                if (indexed) listed.push(indexed)
            }
        }
        return listed
    }

    /**
     * The object a media id names in this session: its handle when a fresh read shows it still holds the same file,
     * otherwise the file of that name and size found by listing the card again.
     */
    async resolve(operation: string, reference: ObjectMediaReference): Promise<IndexedObject> {
        this.currentSession()
        const matches = (indexed: IndexedObject | null | undefined): indexed is IndexedObject =>
            !!indexed &&
            indexed.info.filename === reference.name &&
            (reference.sizeBytes === undefined || indexed.item.sizeBytes === reference.sizeBytes)
        // Always read the handle's info again: the file may have been deleted on the camera since.
        const thumbnails = await this.thumbnailsSupported(operation)
        const fresh = await this.readObject(reference.storageId, reference.objectHandle, thumbnails)
        if (matches(fresh)) {
            this.objects.set(reference.objectHandle, fresh)
            return fresh
        }
        const found = (await this.list(operation)).find(matches)
        if (!found) throw new CameraRefusedError(operation, `${reference.name} is no longer on the card`)
        return found
    }

    /** Folders, and objects the camera will not describe, come back as null: there is nothing to show. */
    private async readObject(storageId: number, objectHandle: number, thumbnails: boolean): Promise<IndexedObject | null> {
        let response
        try {
            response = await this.driver.send(GetObjectInfo, { ObjectHandle: objectHandle })
        } catch (error) {
            if (error instanceof PTPResponseError) return null
            throw error
        }
        const info = response.data
        if (response.code !== OK.code || !info) return null
        if (info.associationType !== 0 || info.objectFormat === ASSOCIATION_FORMAT) return null
        const name = info.filename || `object-${objectHandle}`
        const reportedSize = info.objectCompressedSize
        const sizeBytes = reportedSize === OBJECT_SIZE_UNREPORTED ? undefined : reportedSize
        const capturedAt = ptpDateToIso(info.captureDate)
        const kind = mediaKind(name)
        const item: MediaItem = {
            id: encodeMediaId({ source: 'object', storageId, objectHandle, name, ...(sizeBytes !== undefined && { sizeBytes }) }),
            name,
            kind,
            slot: this.slots.get(storageId) ?? storageId >>> 16,
            ...(sizeBytes !== undefined && { sizeBytes }),
            ...(capturedAt && { capturedAt }),
            ...(info.imagePixWidth > 0 && info.imagePixHeight > 0 && { widthPixels: info.imagePixWidth, heightPixels: info.imagePixHeight }),
            previews: thumbnails && info.thumbCompressedSize > 0 ? ['thumbnail'] : [],
        }
        return { storageId, objectHandle, info, item }
    }
}
