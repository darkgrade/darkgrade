import type { CameraRecordingState } from '@camera/controls'
import type { Clip } from '@camera/driver/video'
import type { Camera } from '@camera/index'
import { requireCapability } from '@camera/operations/context'

export interface VideoOperations {
    /** What the camera reports now: `idle`, `starting`, `recording`, `stopping` or `unknown`. Unknown never counts as idle. */
    getRecordingState(): Promise<CameraRecordingState>
    /**
     * Gets the camera ready (video mode, card destination), checks the card, starts, and resolves
     * once the camera reports recording. Record is sent once and never repeated. Audio is recorded
     * as `setAudioRecording` (or the camera's own menu) left it; startRecording never changes it.
     */
    startRecording(): Promise<void>
    /**
     * Stops, waits until a finished clip is on the card, puts the camera back, and resolves to the
     * clip. Always allowed. Throws CameraClipNotFoundError when the camera stopped but no new clip
     * appeared; called again after a failed restore, it retries only the restore.
     */
    stopRecording(): Promise<Clip>
}

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
}
