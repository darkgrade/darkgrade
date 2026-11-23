import { drawWebcamFrame } from '@renderer/gpu/device'
import { createStore } from '@renderer/lib/external-store'
import { describeWebcamError } from '@shared/webcam-errors'

/** Developer Mode's webcam feed: starting, live, or why it couldn't start. */
export interface WebcamFeedStatus {
    phase: 'off' | 'starting' | 'live' | 'error'
    /** The webcam's name while live, or what went wrong. */
    message: string | null
}

export const webcamFeedStatus = createStore<WebcamFeedStatus>({ phase: 'off', message: null })

/** Asked for at this size; the webcam answers with the nearest it has. */
const IDEAL_WIDTH = 1920
const IDEAL_HEIGHT = 1080

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
/** Each start gets its own number, so a slow start that was stopped meanwhile doesn't come back to life. */
let generation = 0

function drawEachFrame(element: HTMLVideoElement, startedGeneration: number): void {
    const draw = (): void => {
        if (startedGeneration !== generation) return
        void drawWebcamFrame(element)
        element.requestVideoFrameCallback(draw)
    }
    element.requestVideoFrameCallback(draw)
}

/** Opens the default webcam and sends each of its frames to the picture until stopped. */
export async function startWebcamFeed(): Promise<void> {
    if (stream || webcamFeedStatus.get().phase === 'starting') return
    const startedGeneration = ++generation
    webcamFeedStatus.set({ phase: 'starting', message: null })
    try {
        const opened = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { width: { ideal: IDEAL_WIDTH }, height: { ideal: IDEAL_HEIGHT } },
        })
        if (startedGeneration !== generation) {
            opened.getTracks().forEach(track => track.stop())
            return
        }
        const element = document.createElement('video')
        element.muted = true
        element.playsInline = true
        element.srcObject = opened
        await element.play()
        stream = opened
        video = element
        drawEachFrame(element, startedGeneration)
        const track = opened.getVideoTracks()[0]
        track?.addEventListener('ended', () => {
            stopWebcamFeed()
            webcamFeedStatus.set({ phase: 'error', message: 'The webcam was disconnected' })
        })
        webcamFeedStatus.set({ phase: 'live', message: track?.label || 'Webcam' })
    } catch (error) {
        if (startedGeneration !== generation) return
        webcamFeedStatus.set({ phase: 'error', message: describeWebcamError(error) })
    }
}

export function stopWebcamFeed(): void {
    generation++
    stream?.getTracks().forEach(track => track.stop())
    stream = null
    if (video) video.srcObject = null
    video = null
    webcamFeedStatus.set({ phase: 'off', message: null })
}

/** The webcam's current frame as a JPEG, at most `longSidePixels` on its long side; null until it is live. */
export async function webcamJpeg(longSidePixels: number): Promise<Uint8Array | null> {
    if (!video || !video.videoWidth) return null
    const scale = Math.min(1, longSidePixels / Math.max(video.videoWidth, video.videoHeight))
    const canvas = new OffscreenCanvas(Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    return new Uint8Array(await blob.arrayBuffer())
}
