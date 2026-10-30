import {nikonCanRecordToStorage} from '@vendors/nikon/card-storage'

/** Read current card capacity and camera recording capability, independently of host upload access. */
export async function readCameraStorages(camera: any) {
    await camera.getInstance().prepareStorageRead?.()
    const operations = camera.getInstance().registry.operations
    const response = await camera.send(operations.GetStorageIDs, {})
    if (response.code !== 0x2001) throw new Error('Camera storage could not be read (GetStorageIDs: 0x' + response.code.toString(16) + ')')
    const summaries = []
    for (const storageId of response.data || []) {
        if ((Number(storageId) & 0xffff) === 0) continue
        const storage = await camera.send(operations.GetStorageInfo, {StorageID: storageId})
        if (storage.code !== 0x2001) throw new Error('Camera card information could not be read (GetStorageInfo: 0x' + storage.code.toString(16) + ')')
        const info = storage.data || {}
        const access = Number(info.accessCapability ?? info.AccessCapability ?? -1)
        const writable = camera.getInstance().vendorId === 0x04b0
            ? await nikonCanRecordToStorage(camera, access) : access === 0
        summaries.push({
            storageId: Number(storageId),
            description: String(info.storageDescription ?? info.StorageDescription ?? ''),
            volumeLabel: String(info.volumeLabel ?? info.VolumeLabel ?? ''),
            capacityBytes: Number(info.maxCapacity ?? info.MaxCapacity ?? 0),
            freeBytes: Number(info.freeSpaceInBytes ?? info.FreeSpaceInBytes ?? 0),
            freeImages: info.freeSpaceInImages === undefined ? undefined : Number(info.freeSpaceInImages),
            hostAccessCapability: access,
            writable,
        })
    }
    return summaries
}

/** Enumerate populated card slots only; an empty-slot placeholder is not a readable storage. */
export async function readCameraObjectHandles(camera: any): Promise<Set<number>> {
    await camera.getInstance().prepareStorageRead?.()
    const operations = camera.getInstance().registry.operations
    const storage = await camera.send(operations.GetStorageIDs, {})
    if (storage.code !== 0x2001) throw new Error('Camera storage could not be read (GetStorageIDs: 0x' + storage.code.toString(16) + ')')
    const handles = new Set<number>()
    for (const storageId of storage.data || []) {
        if ((Number(storageId) & 0xffff) === 0) continue
        const result = await camera.send(operations.GetObjectHandles, {StorageID: storageId})
        if (result.code !== 0x2001) throw new Error('Camera files could not be listed: 0x' + result.code.toString(16))
        for (const handle of result.data || []) handles.add(Number(handle))
    }
    return handles
}

/** Wait for a newly recorded card movie, tolerating the body's temporary index rejection while it finalizes. */
export async function waitForNewCameraMovie(camera: any, baseline: Set<number>, timeoutMilliseconds = 12000) {
    if (!Number.isInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60000)
        throw new Error('Movie finalization timeout must be 1–60000 milliseconds')
    const operations = camera.getInstance().registry.operations
    const deadline = Date.now() + timeoutMilliseconds
    let lastError: unknown
    do {
        try {
            for (const handle of await readCameraObjectHandles(camera)) {
                if (baseline.has(handle)) continue
                const response = await camera.send(operations.GetObjectInfo, {ObjectHandle: handle})
                const info = response.data, bytes = Number(info?.objectCompressedSize)
                if (response.code === 0x2001 && Number.isSafeInteger(bytes) && bytes > 0 && info?.associationType === 0
                    && /\.(mp4|mov|mts|m2ts|avi|crm)$/i.test(info?.filename || '')) return {...info, handle}
            }
        } catch (error) { lastError = error }
        const remaining = deadline - Date.now()
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
    } while (Date.now() < deadline)
    throw new Error('Recording stopped, but a new movie was not finalized on the card within ' + timeoutMilliseconds / 1000 + ' seconds'
        + (lastError ? ': ' + String(lastError) : ''))
}
