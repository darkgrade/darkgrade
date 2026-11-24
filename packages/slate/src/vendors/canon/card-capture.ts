import type { CanonCamera } from '@camera/canon-camera'
import { readCameraObjectHandles } from '@camera/storage'
import { PTPResponseError } from '@core/ptp-errors'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'

/** Return only a newly indexed still; a command acknowledgement or an old card image is not a capture. */
export async function captureCanonCardImage(
    camera: CanonCamera,
    capture: () => Promise<void>,
    options: { includeInfo: boolean; includeData: boolean },
): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
    const storageCamera = { getInstance: () => camera, send: camera.send.bind(camera) }
    const baseline = await readCameraObjectHandles(storageCamera)
    await capture()
    const deadline = Date.now() + 8000
    let lastError: unknown
    do {
        try {
            const candidates: Array<{ handle: number; info: ObjectInfo }> = []
            for (const handle of await readCameraObjectHandles(storageCamera)) {
                if (baseline.has(handle)) continue
                const response = await camera.send(camera.registry.operations.GetObjectInfo, { ObjectHandle: handle })
                if (response.code !== 0x2001)
                    throw new PTPResponseError(response.code, 'Canon captured-image information could not be read')
                const info = response.data
                if (!info) throw new Error('Canon captured-image metadata is missing')
                if (info.associationType !== 0 || !/\.(jpe?g|heif|heic|cr2|cr3)$/i.test(info.filename)) continue
                if (info.objectCompressedSize === 0) continue
                if (!Number.isSafeInteger(info.objectCompressedSize) ||
                    info.objectCompressedSize < 0 || info.objectCompressedSize > 100 * 1024 * 1024)
                    throw new Error('Canon captured-image size is invalid or exceeds the 100 MiB transfer bound')
                candidates.push({ handle, info })
            }
            // Prefer the JPEG when a RAW+JPEG pair is already indexed, without changing the body format.
            candidates.sort((left, right) => Number(/\.jpe?g$/i.test(right.info.filename)) -
                Number(/\.jpe?g$/i.test(left.info.filename)))
            const image = candidates[0]
            if (image) {
                const data = options.includeData
                    ? await camera.getObject(image.handle, image.info.objectCompressedSize) : undefined
                if (data && data.length !== image.info.objectCompressedSize)
                    throw new Error('Canon captured-image transfer length does not match its metadata')
                return { ...(options.includeInfo ? { info: image.info } : {}), ...(data ? { data } : {}) }
            }
        } catch (error) {
            // Indexing can be busy while the camera saves a new file. Transfer/metadata failures are definitive.
            if (!(error instanceof PTPResponseError) || error.code !== 0x2019) throw error
            lastError = error
        }
        const remaining = deadline - Date.now()
        if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(250, remaining)))
    } while (Date.now() < deadline)
    throw new Error('Canon shutter completed, but no new still image appeared on the card within 8 seconds' +
        (lastError ? `: ${String(lastError)}` : ''))
}
