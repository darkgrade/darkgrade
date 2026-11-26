import { CameraClipNotFoundError } from '@camera/errors'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import {PTPDecodeError, PTPResponseError} from '@core/ptp-errors'
import { cardSlotNumbers, mediaKind } from '@vendors/generic/media-id'

/** What the card readings need from a driver; Sony also switches to content transfer first. */
export type StorageDriver = Pick<GenericCamera, 'registry' | 'send' | 'storageCanRecord'> & { prepareStorageRead?(): Promise<void> }
type HandleDriver = Pick<StorageDriver, 'registry' | 'send' | 'prepareStorageRead'>

/** Read current card capacity and camera recording capability, independently of host upload access. */
export async function readCameraStorages(driver: StorageDriver) {
    await driver.prepareStorageRead?.()
    const operations = driver.registry.operations
    const response = await driver.send(operations.GetStorageIDs, {})
    if (response.code !== 0x2001) throw new PTPResponseError(response.code, 'Camera storage could not be read (GetStorageIDs: 0x' + response.code.toString(16) + ')')
    const summaries = []
    const slots = cardSlotNumbers((response.data || []).map(Number))
    for (const storageId of response.data || []) {
        if ((Number(storageId) & 0xffff) === 0) continue
        const storage = await driver.send(operations.GetStorageInfo, {StorageID: storageId})
        if (storage.code !== 0x2001) throw new PTPResponseError(storage.code, 'Camera card information could not be read (GetStorageInfo: 0x' + storage.code.toString(16) + ')')
        const info = storage.data || {}
        const access = Number(info.accessCapability ?? -1)
        const recording = await driver.storageCanRecord(Number(storageId), access)
        summaries.push({
            storageId: Number(storageId),
            slot: slots.get(Number(storageId)) ?? Number(storageId) >>> 16,
            description: String(info.storageDescription ?? ''),
            volumeLabel: String(info.volumeLabel ?? ''),
            capacityBytes: Number(info.maxCapacity ?? 0),
            freeBytes: Number(info.freeSpaceInBytes ?? 0),
            freeImages: info.freeSpaceInImages === undefined ? undefined : Number(info.freeSpaceInImages),
            hostAccessCapability: access,
            ...recording,
        })
    }
    return summaries
}

/** Enumerate populated card slots only; an empty-slot placeholder is not a readable storage. */
export async function readCameraObjectHandles(driver: HandleDriver): Promise<Set<number>> {
    await driver.prepareStorageRead?.()
    const operations = driver.registry.operations
    const storage = await driver.send(operations.GetStorageIDs, {})
    if (storage.code !== 0x2001) throw new PTPResponseError(storage.code, 'Camera storage could not be read (GetStorageIDs: 0x' + storage.code.toString(16) + ')')
    if (!Array.isArray(storage.data)) throw new PTPDecodeError('GetStorageIDs returned no storage dataset')
    const handles = new Set<number>()
    for (const storageId of storage.data) {
        if ((Number(storageId) & 0xffff) === 0) continue
        const result = await driver.send(operations.GetObjectHandles, {StorageID: storageId})
        if (result.code !== 0x2001) throw new PTPResponseError(result.code, 'Camera files could not be listed: 0x' + result.code.toString(16))
        if (!Array.isArray(result.data)) throw new PTPDecodeError('GetObjectHandles returned no object dataset')
        for (const handle of result.data) handles.add(Number(handle))
    }
    return handles
}

/**
 * The one way the card is watched for a new file: list it until `scan`, given the handles not in
 * `baseline`, returns a result, or the deadline passes. A failed listing or scan is kept and the card
 * read again, unless `tolerate` says otherwise (it is then thrown). Callers say what counts as their
 * new file; the poll stays (a recorded exchange is never replayed for it).
 */
export async function pollNewCardObjects<Result>(
    driver: HandleDriver,
    baseline: ReadonlySet<number>,
    options: {
        scan: (handles: number[]) => Promise<Result | undefined>
        timeoutMilliseconds: number
        intervalMilliseconds?: number
        tolerate?: (error: unknown) => boolean
    }
): Promise<{ found?: Result; lastError?: unknown }> {
    const interval = options.intervalMilliseconds ?? 250
    const deadline = Date.now() + options.timeoutMilliseconds
    let lastError: unknown
    do {
        try {
            const fresh = [...(await readCameraObjectHandles(driver))].filter(handle => !baseline.has(handle))
            const found = await options.scan(fresh)
            if (found !== undefined) return { found }
        } catch (error) {
            if (options.tolerate && !options.tolerate(error)) throw error
            lastError = error
        }
        const remaining = deadline - Date.now()
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(interval, remaining)))
    } while (Date.now() < deadline)
    return { lastError }
}

/** Wait for a newly recorded card movie, tolerating the body's temporary index rejection while it finalizes. */
export async function waitForNewCameraMovie(driver: HandleDriver, baseline: Set<number>, timeoutMilliseconds = 12000) {
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60000)
        throw new Error('Movie finalization timeout must be 1–60000 milliseconds')
    const operations = driver.registry.operations
    const { found, lastError } = await pollNewCardObjects(driver, baseline, {
        timeoutMilliseconds,
        scan: async handles => {
            for (const handle of handles) {
                const response = await driver.send(operations.GetObjectInfo, {ObjectHandle: handle})
                const info = response.data, bytes = Number(info?.objectCompressedSize)
                if (response.code === 0x2001 && Number.isSafeInteger(bytes) && bytes > 0 && info?.associationType === 0
                    && mediaKind(info?.filename || '') === 'clip') return {...info, handle}
            }
        },
    })
    if (found) return found
    throw new CameraClipNotFoundError('stopRecording', 'Recording stopped, but a new movie was not finalized on the card within ' + timeoutMilliseconds / 1000 + ' seconds'
        + (lastError ? ': ' + String(lastError) : ''))
}
