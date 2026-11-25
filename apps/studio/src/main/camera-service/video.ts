import { Camera, CameraConfirmationError, type CameraRecordingState } from '@darkgrade/slate'
import type { CameraService } from '@main/camera-service'
import { errorMessage } from '@main/camera-service/shared'
import type { CameraState } from '@shared/ipc'

/** The camera service's recording. Installed on CameraService in camera-service.ts. */
export interface VideoOperations {
    // -------------------------------------------------------------- recording

    startRecording(): Promise<CameraState>
    stopRecording(): Promise<CameraState>
    observeFailedRecording(camera: Camera, error: unknown): Promise<CameraRecordingState>
}

export const videoOperations: VideoOperations & ThisType<CameraService> = {
    // -------------------------------------------------------------- recording

    async startRecording(): Promise<CameraState> {
        const camera = this.requireCameraForControl()
        await this.enqueue(async () => {
            if (this.recording) throw new Error('Stop and confirm the current recording before starting another')
            this.recordingMode = await camera.prepareRecordingMode()
            this.recordingStopConfirmed = false
            this.recording = true
            this.recordingState = 'starting'
            this.broadcastState()
            try {
                await camera.startRecording()
                this.recordingState = 'recording'
                this.log('system', 'Recording confirmed')
            } catch (error) {
                const observed = await this.observeFailedRecording(camera, error)
                if (observed === 'idle') {
                    this.recordingStopConfirmed = true
                    this.recording = true
                    await this.recordingMode?.restore()
                    this.recordingMode = undefined
                    this.recordingStopConfirmed = false
                    this.recording = false
                }
                throw error
            } finally {
                this.broadcastState()
            }
        })
        return this.getState()
    },

    async stopRecording(): Promise<CameraState> {
        const camera = this.requireCamera()
        await this.enqueue(async () => {
            this.recordingState = 'stopping'
            this.broadcastState()
            try {
                if (!this.recordingStopConfirmed) {
                    await camera.stopRecording()
                    this.recordingStopConfirmed = true
                }
                this.recordingState = 'idle'
                await this.recordingMode?.restore()
                this.recordingMode = undefined
                this.recordingStopConfirmed = false
                this.recording = false
                this.log('system', 'Recording stop confirmed')
            } catch (error) {
                if (this.recordingStopConfirmed) {
                    this.recordingState = 'idle'
                    this.recording = true
                    this.log(
                        'system',
                        `Recording stopped; camera setup restoration failed: ${errorMessage(error)}. Retry Stop.`,
                        'error'
                    )
                } else if ((await this.observeFailedRecording(camera, error)) === 'idle') {
                    // A lost Stop reply can still leave verified idle with the prepared mode owned.
                    this.recordingStopConfirmed = true
                    this.recording = true
                    this.log('system', 'Camera is idle; retry Stop to finish restoring camera setup.')
                }
                throw error
            } finally {
                this.broadcastState()
            }
        })
        this.scheduleFilesRefresh()
        this.broadcastState()
        return this.getState()
    },

    async observeFailedRecording(camera: Camera, error: unknown): Promise<CameraRecordingState> {
        this.recordingState =
            error instanceof CameraConfirmationError &&
            ['idle', 'recording', 'starting', 'stopping'].includes(error.observed ?? '')
                ? (error.observed as CameraRecordingState)
                : await camera.getRecordingState().catch(() => 'unknown' as const)
        // Unknown still needs a usable Stop action; it is never displayed as confirmed recording.
        this.recording = this.recordingState !== 'idle'
        this.log('system', `Recording change unconfirmed: ${errorMessage(error)}`, 'error')
        return this.recordingState
    },
}
