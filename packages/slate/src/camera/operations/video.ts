import type { CameraRecordingState } from '@camera/controls'
import type { Clip } from '@camera/driver/video'
import type { Camera } from '@camera/index'
import { CanonCamera } from '@camera/canon-camera'
import { canonDriver, cameraContext, requireCapability } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { openCanonRecordingMode } from '@vendors/canon/recording-mode'
import { openSonyRecordingMode } from '@vendors/sony/photo-mode'

export interface VideoOperations {
    /** What the camera reports now: `idle`, `starting`, `recording`, `stopping` or `unknown`. Unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
    /**
     * Gets the camera ready (video mode, card destination, audio), checks the card, starts, and
     * resolves once the camera reports recording. Record is sent once and never repeated.
     */
    startRecording(): Promise<void>
    /**
     * Stops, waits until a finished clip is on the card, puts the camera back, and resolves to the
     * clip. Always allowed. Throws CameraClipNotFoundError when the camera stopped but no new clip
     * appeared; called again after a failed restore, it retries only the restore.
     */
    stopRecording(): Promise<Clip>
    /** @deprecated startRecording prepares the recording mode and stopRecording restores it. */
    prepareRecordingMode(): Promise<{ restore(): Promise<void> }>
    /** @deprecated startRecording selects video mode. */
    enterMovieMode(): Promise<void>
    /** @deprecated stopRecording restores the previous mode. */
    leaveMovieMode(): Promise<void>
    /** @deprecated startRecording prepares the card destination. */
    prepareCanonRecordingDestination(): Promise<() => Promise<void>>
    /** @deprecated startRecording turns on movie sound when it is off. */
    ensureCanonMovieSoundRecording(): Promise<boolean>
}

const canonMovieModeUnavailable = 'Canon movie mode is only available for Canon EOS cameras'

export const videoOperations: VideoOperations & ThisType<Camera> = {
    async getRecordingState(): Promise<CameraRecordingState> {
        return requireCapability(this, 'video', 'getRecordingState').getRecordingState()
    },

    async startRecording(): Promise<void> {
        return requireCapability(this, 'video', 'startRecording').startRecording()
    },

    async stopRecording(): Promise<Clip> {
        return requireCapability(this, 'video', 'stopRecording').stopRecording()
    },

    async prepareRecordingMode(): Promise<{ restore(): Promise<void> }> {
        const { driver } = cameraContext(this)
        if (driver instanceof CanonCamera) return openCanonRecordingMode(this)
        if (driver instanceof SonyCamera) return openSonyRecordingMode(this)
        return { restore: async () => {} }
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
