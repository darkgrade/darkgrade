import {nikonCanRecordToStorage} from '@vendors/nikon/card-storage'

/** Read current card capacity and camera recording capability, independently of host upload access. */
export async function readCameraStorages(camera: any) {
    const operations = camera.getInstance().registry.operations
    const response = await camera.send(operations.GetStorageIDs, {})
    if (response.code !== 0x2001) throw new Error('Camera storage could not be read')
    const summaries = []
    for (const storageId of response.data || []) {
        if ((Number(storageId) & 0xffff) === 0) continue
        const storage = await camera.send(operations.GetStorageInfo, {StorageID: storageId})
        if (storage.code !== 0x2001) throw new Error('Camera card information could not be read')
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
