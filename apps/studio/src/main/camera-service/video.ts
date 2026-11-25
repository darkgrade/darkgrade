import {
    Camera,
    CameraClipNotFoundError,
    CameraConfirmationError,
    CameraOutcomeUnknownError,
    type CameraRecordingState,
} from '@darkgrade/slate'
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

/**
 * Slate prepares the camera for recording (video mode, card, audio) inside startRecording and puts
 * it back inside stopRecording, after a confirmed idle. When that restore fails, Slate keeps it
 * pending and the next stopRecording retries only the restore, so Stop stays available here.
 */
export const videoOperations: VideoOperations & ThisType<CameraService> = {
    // -------------------------------------------------------------- recording

    async startRecording(): Promise<CameraState> {
        const camera = this.requireCameraForControl()
        await this.enqueue(async () => {
            if (this.recording) throw new Error('Stop and confirm the current recording before starting another')
            this.recording = true
            this.recordingState = 'starting'
            this.broadcastState()
            try {
                await camera.startRecording()
                this.recordingState = 'recording'
                this.log('system', 'Recording confirmed')
            } catch (error) {
                // An idle camera was put back by Slate, unless the failure is not a plain unconfirmed
                // or refused Record: then its setup may still be pending, and Stop finishes it.
                const observed = await this.observeFailedRecording(camera, error)
                if (observed === 'idle' && error instanceof CameraOutcomeUnknownError && !(error instanceof CameraConfirmationError))
                    this.recording = true
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
                const clip = await camera.stopRecording()
                this.recordingState = 'idle'
                this.recording = false
                this.log('system', `Recording stop confirmed; ${clip.name} is on the card`)
            } catch (error) {
                if (error instanceof CameraClipNotFoundError) {
                    // Stopped and put back; only the new clip could not be identified.
                    this.recordingState = 'idle'
                    this.recording = false
                    this.log('system', `Recording stopped, but no new clip was found: ${errorMessage(error)}`, 'error')
                    return
                }
                if ((await this.observeFailedRecording(camera, error)) === 'idle') {
                    // Stopped, but the camera setup was not put back; Stop retries the restore.
                    this.recording = true
                    this.log(
                        'system',
                        `Recording stopped; camera setup restoration failed: ${errorMessage(error)}. Retry Stop.`,
                        'error'
                    )
                }
                throw error
            } finally {
                this.broadcastState()
            }
        })
        await this.resumeShooting()
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
