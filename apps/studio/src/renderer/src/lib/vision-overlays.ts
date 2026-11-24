import { currentFrameTexture } from '@renderer/gpu/device'
import { createStore } from '@renderer/lib/external-store'
import { RateMeter, startLatestFrameLoop } from '@renderer/lib/latest-frame-loop'
import { latestLiveFrame } from '@renderer/lib/live-frame-store'
import {
    DEFAULT_SEGMENTATION_PROMPT,
    type VisionEngineStatus,
    type VisionModelId,
    type VisionOverlay,
} from '@shared/vision-models'
import { useEffect } from 'react'

/**
 * Developer Mode's live vision overlays (scopes panel): Depth Pro 2's depth map and SAM 3's instances drawn over the
 * picture, either or both. Each runs on the newest frame in its own loop and its own process, so neither waits for
 * the other, nor for voice or the assistant.
 */
export const overlaysEnabled = createStore<Record<VisionModelId, boolean>>({ 'depth-pro-2': false, sam3: false })

export function setOverlayEnabled(id: VisionModelId, enabled: boolean): void {
    overlaysEnabled.set({ ...overlaysEnabled.get(), [id]: enabled })
}

/** What SAM 3 looks for: a short noun phrase, read afresh for every frame. */
export const segmentationPrompt = createStore<string>(DEFAULT_SEGMENTATION_PROMPT)

/** One overlay as it stands: its newest picture and how fast it is refreshing, or why it stopped. */
export interface OverlayState {
    /** The newest overlay, already decoded, as a data URL. */
    imageUrl: string | null
    framesPerSecond: number | null
    /** From sending the frame to the overlay being ready to show. */
    roundTripMilliseconds: number | null
    detail: string | null
    error: string | null
}

const IDLE_OVERLAY: OverlayState = {
    imageUrl: null,
    framesPerSecond: null,
    roundTripMilliseconds: null,
    detail: null,
    error: null,
}

export const overlayStates: Record<VisionModelId, ReturnType<typeof createStore<OverlayState>>> = {
    'depth-pro-2': createStore<OverlayState>(IDLE_OVERLAY),
    sam3: createStore<OverlayState>(IDLE_OVERLAY),
}

/** Each model's engine (downloading, starting, ready), for the scopes panel while an overlay waits on it. */
export const visionEngineStatus = createStore<Record<VisionModelId, VisionEngineStatus> | null>(null)
let watchingEngines = false
function watchVisionEngines(): void {
    if (watchingEngines) return
    watchingEngines = true
    void window.studio.visionGetStatus().then(result => result.ok && visionEngineStatus.set(result.data))
    window.studio.onVisionStatus(visionEngineStatus.set)
}

const NEW_FRAME_POLL_MILLISECONDS = 16

/** The newest frame as a JPEG (null: the camera's, which the main process already holds). */
interface OverlayFrame {
    jpeg: Uint8Array | null
}

function newestFrameTaker(): () => Promise<OverlayFrame | null> {
    let takenVersion = -1
    return async () => {
        const texture = currentFrameTexture()
        if (!texture || texture.version === takenVersion) return null
        takenVersion = texture.version
        const frame = latestLiveFrame()
        if (!frame) return null
        return { jpeg: frame.blob.size > 0 ? new Uint8Array(await frame.blob.arrayBuffer()) : null }
    }
}

function overlayDetail(id: VisionModelId, overlay: VisionOverlay): string {
    if (id === 'sam3') {
        const count = overlay.instanceCount ?? 0
        return `${count} ${count === 1 ? 'instance' : 'instances'}`
    }
    return overlay.medianMetres == null ? 'median depth unknown' : `median ${overlay.medianMetres.toFixed(2)} m`
}

async function inferOverlay(id: VisionModelId, frame: OverlayFrame): Promise<VisionOverlay & { imageUrl: string }> {
    const result = await window.studio.visionOverlay(id, frame.jpeg, segmentationPrompt.get())
    if (!result.ok) throw new Error(result.error)
    const imageUrl = `data:image/png;base64,${result.data.imagePng}`
    // Decoded before it is shown, so the overlay swaps from one picture to the next without a blank in between.
    const image = new Image()
    image.src = imageUrl
    await image.decode()
    return { ...result.data, imageUrl }
}

function runOverlay(id: VisionModelId): () => void {
    const state = overlayStates[id]
    const meter = new RateMeter()
    state.set(IDLE_OVERLAY)
    return startLatestFrameLoop({
        takeNewestFrame: newestFrameTaker(),
        infer: frame => inferOverlay(id, frame),
        waitForFrame: () => new Promise(resolve => setTimeout(resolve, NEW_FRAME_POLL_MILLISECONDS)),
        show: (overlay, roundTripMilliseconds) => {
            const now = performance.now()
            meter.record(now)
            state.set({
                imageUrl: overlay.imageUrl,
                framesPerSecond: meter.perSecond(now),
                roundTripMilliseconds,
                detail: overlayDetail(id, overlay),
                error: null,
            })
        },
        fail: message => state.set({ ...IDLE_OVERLAY, error: message }),
    })
}

function useOverlayLoop(id: VisionModelId, on: boolean): void {
    useEffect(() => {
        if (!on) return
        watchVisionEngines()
        const stop = runOverlay(id)
        return () => {
            stop()
            overlayStates[id].set(IDLE_OVERLAY)
        }
    }, [id, on])
}

/** Runs each overlay that is switched on while `allowed` (Developer Mode with a live picture); clears it when off. */
export function useVisionOverlayLoops(allowed: boolean): void {
    const enabled = overlaysEnabled.use()
    useOverlayLoop('depth-pro-2', allowed && enabled['depth-pro-2'])
    useOverlayLoop('sam3', allowed && enabled.sam3)
}
