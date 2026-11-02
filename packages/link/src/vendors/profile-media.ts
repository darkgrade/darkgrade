import type {Camera} from '@camera/index'
import {readCameraObjectHandles} from '@camera/storage'
import {PTPResponseError} from '@core/ptp-errors'
import type {ObjectInfo} from '@ptp/datasets/object-info-dataset'
import {withSonyPhotoMode} from '@vendors/sony/photo-mode'

/** Record the same card workflow as the bench: baseline, one shutter, new object and complete transfer. */
export async function captureProfilePhoto(camera: Camera, options: {
    autofocus: boolean; destination?: 'card' | 'memory'; rawCompression?: 'lossless'
}): Promise<{info?: ObjectInfo; data?: Uint8Array}> {
    const vendor = camera.getInstance().vendorId
    if (options.destination === 'memory' || ![0x04b0, 0x054c].includes(vendor!))
        return camera.captureImage({includeInfo: true, includeData: true, ...options})
    const capture = async () => {
        const baseline = await readCameraObjectHandles(camera)
        await camera.captureImage({includeInfo: false, includeData: false, ...options})
        const deadline = Date.now() + 8000
        do {
            try {
                for (const handle of await readCameraObjectHandles(camera)) {
                    if (baseline.has(handle)) continue
                    const response = await camera.send(camera.getInstance().registry.operations.GetObjectInfo, {ObjectHandle: handle})
                    if (response.code !== 0x2001) throw new PTPResponseError(response.code, 'New card image metadata rejected')
                    const info = response.data
                    if (!info) throw new Error('New card image metadata missing')
                    if (info.associationType !== 0 || !/\.(jpe?g|heif|heic|nef|arw|dng)$/i.test(info.filename)) continue
                    if (!Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize <= 0 ||
                        info.objectCompressedSize > 100 * 1024 * 1024) throw new Error('New card image size is invalid')
                    const data = await camera.getObject(handle, info.objectCompressedSize)
                    if (data.length !== info.objectCompressedSize) throw new Error('New card image transfer length mismatch')
                    return {info, data}
                }
            } catch (error) {
                if (!(error instanceof PTPResponseError) || error.code !== 0x2019) throw error
            }
            const remaining = deadline - Date.now()
            if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
        } while (Date.now() < deadline)
        throw new Error('Shutter completed but no new card image appeared')
    }
    return vendor === 0x054c ? withSonyPhotoMode(camera, capture) : capture()
}
