import { pendingArea, type SmokeArea } from '@scripts/camera-smoke/smoke-area'

/** Replace with real steps when this area's operations land; see settings.ts for the pattern. */
export const videoSmoke: SmokeArea = pendingArea('video', 'startRecording, stopRecording and getRecordingState')
