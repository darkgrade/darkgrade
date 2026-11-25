import { CameraOutcomeUnknownError } from '@darkgrade/slate'
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
        // Saved to the card as well; resolves only once the camera shows the new file.
        const photo = await this.enqueue(() =>
            camera.takePhoto({ autofocus: options.autofocus ?? true, destination: 'computer' })
        ).catch(error => {
            // The shutter may have fired: never retake on the user's behalf; show what is on the card.
            if (error instanceof CameraOutcomeUnknownError) {
                this.log('system', 'The photo could not be confirmed; check the card before taking another', 'error')
                this.scheduleFilesRefresh()
            }
            throw error
        })
        const { data, name: filename } = photo
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
        this.scheduleFilesRefresh()
        return result
    },
}
