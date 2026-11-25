import type { CameraService } from '@main/camera-service'
import { PREVIEWABLE_EXTENSIONS, PREVIEW_MAX_BYTES, formatBytes } from '@main/camera-service/shared'
import type { CaptureOptions, CaptureResult } from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'

/** The camera service's taking photos. Installed on CameraService in camera-service.ts. */
export interface PhotoOperations {
    // ---------------------------------------------------------------- capture

    capture(options?: CaptureOptions): Promise<CaptureResult>
}

export const photoOperations: PhotoOperations & ThisType<CameraService> = {
    // ---------------------------------------------------------------- capture

    async capture(options: CaptureOptions = {}): Promise<CaptureResult> {
        const camera = this.requireCameraForControl()
        const { info, data } = await this.enqueue(() => camera.captureImage({ autofocus: options.autofocus ?? true }))
        if (!data) throw new Error('Camera returned no image data')

        const filename = info?.filename ?? `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
        const savedPath = await this.saveToDownloadDir(filename, data)
        this.log('system', `Captured ${filename} (${formatBytes(data.byteLength)}) → ${savedPath}`)

        const extension = filename.split('.').pop()?.toLowerCase() ?? ''
        const previewable = PREVIEWABLE_EXTENSIONS.includes(extension) && data.byteLength <= PREVIEW_MAX_BYTES
        const result: CaptureResult = {
            filename,
            savedPath,
            sizeBytes: data.byteLength,
            previewData: previewable ? data : undefined,
        }
        this.broadcast(IPC_EVENTS.Capture, result)
        await this.resumeShooting()
        this.scheduleFilesRefresh()
        return result
    },
}
