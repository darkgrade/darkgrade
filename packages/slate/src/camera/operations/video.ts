import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import type { CameraRecordingState } from '@camera/controls'
import type { Camera } from '@camera/index'
import { CanonCamera } from '@camera/canon-camera'
import { canonDriver, cameraContext } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { readCameraRecordingState } from '@camera/video-recording'
import { openCanonRecordingMode } from '@vendors/canon/recording-mode'
import { readSonyMovieCard } from '@vendors/sony/card-storage'
import { openSonyRecordingMode } from '@vendors/sony/photo-mode'

export interface VideoOperations {
    getRecordingState(): Promise<CameraRecordingState>
    startRecording(): Promise<void>
    /** Hold the camera's required recording mode until a confirmed stop, then restore it. */
    prepareRecordingMode(): Promise<{ restore(): Promise<void> }>
    stopRecording(): Promise<void>
    enterMovieMode(): Promise<void>
    leaveMovieMode(): Promise<void>
    prepareCanonRecordingDestination(): Promise<() => Promise<void>>
    ensureCanonMovieSoundRecording(): Promise<boolean>
}

const canonMovieModeUnavailable = 'Canon movie mode is only available for Canon EOS cameras'

export const videoOperations: VideoOperations & ThisType<Camera> = {
    async getRecordingState(): Promise<CameraRecordingState> {
        return readCameraRecordingState(this)
    },

    async startRecording(): Promise<void> {
        const context = cameraContext(this)
        return context.controlsQueue.run('camera', async () => {
            const state = await this.getRecordingState()
            if (state === 'stopping') await confirmCameraValue('record_start', 'idle', () => this.getRecordingState(), 5000)
            else if (state !== 'idle') throw new CameraConfirmationError('record_start', 'idle before starting', state)
            if (context.driver instanceof SonyCamera && (await readSonyMovieCard(this)).remainingMovieSeconds === 0)
                throw new Error('No movie recording time remains on the selected Sony memory card')
            await context.driver.startRecording()
            await confirmCameraValue('record_start', 'recording', () => this.getRecordingState(), 5000)
        })
    },

    async prepareRecordingMode(): Promise<{ restore(): Promise<void> }> {
        const { driver } = cameraContext(this)
        if (driver instanceof CanonCamera) return openCanonRecordingMode(this)
        if (driver instanceof SonyCamera) return openSonyRecordingMode(this)
        return { restore: async () => {} }
    },

    async stopRecording(): Promise<void> {
        const context = cameraContext(this)
        return context.controlsQueue.run('camera', async () => {
            // Sony's movie-button release still belongs to cleanup after an ignored press.
            if (!(context.driver instanceof SonyCamera) && (await this.getRecordingState()) === 'idle') return
            await context.driver.stopRecording()
            await confirmCameraValue('record_stop', 'idle', () => this.getRecordingState(), 15000)
        })
    },

    async enterMovieMode(): Promise<void> {
        return canonDriver(this, canonMovieModeUnavailable).enterMovieMode()
    },

    async leaveMovieMode(): Promise<void> {
        return canonDriver(this, canonMovieModeUnavailable).leaveMovieMode()
    },

    async prepareCanonRecordingDestination(): Promise<() => Promise<void>> {
        return canonDriver(this).prepareRecordingDestination()
    },

    async ensureCanonMovieSoundRecording(): Promise<boolean> {
        return canonDriver(this).ensureMovieSoundRecording()
    },
}
