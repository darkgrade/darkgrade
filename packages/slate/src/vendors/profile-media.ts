import { captureDriverImage, type CaptureImageOptions } from '@camera/operations/photo'
import { protocolAccess } from '@camera/operations/protocol'
import type { Camera } from '@camera/index'
import { readCameraObjectHandles } from '@camera/storage'
import { PTPResponseError } from '@core/ptp-errors'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { withSonyPhotoMode } from '@vendors/sony/photo-mode'

/** Record the same card workflow as the bench: baseline, one shutter, new object and complete transfer. */
export async function captureProfilePhoto(
    camera: Camera,
    options: {
        autofocus: boolean
        destination?: 'card' | 'memory'
        rawCompression?: 'lossless'
    },
    release: (params: CaptureImageOptions) => Promise<{ info?: ObjectInfo; data?: Uint8Array }> = params =>
        captureDriverImage(camera, params)
): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
    const session = protocolAccess(camera)
    const vendor = session.driver.vendorId
    if ((options.destination === 'memory' && vendor !== 0x054c) || ![0x04b0, 0x054c].includes(vendor!))
        return release({ includeInfo: true, includeData: true, ...options })
    const capture = async () => {
        if (options.destination === 'memory')
            return release({ includeInfo: true, includeData: true, ...options })
        const baseline = await readCameraObjectHandles(camera)
        await release({ includeInfo: false, includeData: false, ...options })
        const deadline = Date.now() + 8000
        do {
            try {
                for (const handle of await readCameraObjectHandles(camera)) {
                    if (baseline.has(handle)) continue
                    const response = await session.send(session.driver.registry.operations.GetObjectInfo, {
                        ObjectHandle: handle,
                    })
                    if (response.code !== 0x2001)
                        throw new PTPResponseError(response.code, 'New card image metadata rejected')
                    const info = response.data
                    if (!info) throw new Error('New card image metadata missing')
                    if (info.associationType !== 0 || !/\.(jpe?g|heif|heic|nef|arw|dng)$/i.test(info.filename)) continue
                    if (
                        !Number.isSafeInteger(info.objectCompressedSize) ||
                        info.objectCompressedSize <= 0 ||
                        info.objectCompressedSize > 100 * 1024 * 1024
                    )
                        throw new Error('New card image size is invalid')
                    const data = await session.driver.getObject(handle, info.objectCompressedSize)
                    if (data.length !== info.objectCompressedSize)
                        throw new Error('New card image transfer length mismatch')
                    return { info, data }
                }
            } catch (error) {
                if (!(error instanceof PTPResponseError) || error.code !== 0x2019) throw error
            }
            const remaining = deadline - Date.now()
            if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
        } while (Date.now() < deadline)
        throw new Error('Shutter completed but no new card image appeared')
    }
    if (vendor !== 0x054c) return capture()
    // Read-only profile initialization preserves the body's dial priority. A still workflow
    // must temporarily claim host priority before changing Movie to Photo, then restore it.
    const properties = session.driver.registry.properties
    if (!('PositionKeySetting' in properties) || !('StillImageSaveDestination' in properties))
        throw new Error('Sony recording controls are unavailable in this camera registry')
    const priority = properties.PositionKeySetting
    const original = await session.get(priority)
    const destination = properties.StillImageSaveDestination
    const originalDestination = options.destination !== 'memory' ? await session.get(destination) : undefined
    let failure: unknown
    try {
        if (original !== 'HOST_PRIORITY') await session.set(priority, 'HOST_PRIORITY')
        if (originalDestination !== undefined && originalDestination !== 'CAMERA_DEVICE')
            await session.set(destination, 'CAMERA_DEVICE')
        const exposureProgram = session.driver.registry.properties.ExposureProgramMode
        return await withSonyPhotoMode({
            refreshPropertyStates: () => session.getSonyPropertyStates(),
            setExposureProgram: value => session.set(exposureProgram, value),
        }, capture)
    } catch (error) {
        failure = error
        throw error
    } finally {
        const errors: unknown[] = []
        if (originalDestination !== undefined && originalDestination !== 'CAMERA_DEVICE')
            await session.set(destination, originalDestination).catch(error => errors.push(error))
        if (original !== 'HOST_PRIORITY') await session.set(priority, original).catch(error => errors.push(error))
        if (errors.length)
            throw new AggregateError(
                [...(failure ? [failure] : []), ...errors],
                'Sony recording settings restoration failed'
            )
    }
}
