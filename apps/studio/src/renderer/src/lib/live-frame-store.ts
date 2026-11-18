import { createStore } from '@renderer/lib/external-store'
import { readJpegSize } from '@renderer/lib/jpeg-size'
import type { FocusFrame } from '@shared/ipc'
import { useSyncExternalStore } from 'react'

/** One live-view JPEG, as a blob for decoding off the main thread and a URL for <img>. */
export interface LiveFrame {
    blob: Blob
    url: string
}

/**
 * Holds the latest live frame outside React state, so a new frame (30 a second) re-renders only the
 * few components that draw it, never the whole app.
 */
const listeners = new Set<() => void>()
let current: LiveFrame | null = null
/** URLs stay valid a few frames longer: decoders that started on an older frame can still finish. */
const retired: string[] = []
const RETIRED_URLS_KEPT = 4

/** Live view's frame rate (averaged over this window) and frame size, for the preview's details only. */
const FRAME_RATE_WINDOW_MS = 10_000
let frameTimes: number[] = []
export const liveFrameRate = createStore<number | null>(null)
export const liveFrameSize = createStore<{ width: number; height: number } | null>(null)
setInterval(() => {
    const now = performance.now()
    frameTimes = frameTimes.filter(time => now - time <= FRAME_RATE_WINDOW_MS)
    const spanSeconds = Math.min(Math.max((now - (frameTimes[0] ?? now)) / 1000, 1), FRAME_RATE_WINDOW_MS / 1000)
    // Rounded as shown, so a steady rate doesn't re-render its readout every second.
    const rate = frameTimes.length < 2 ? null : Math.round((frameTimes.length / spanSeconds) * 10) / 10
    if (rate !== liveFrameRate.get()) liveFrameRate.set(rate)
}, 1000)

export function publishLiveFrame(jpeg: Uint8Array): void {
    frameTimes.push(performance.now())
    const size = readJpegSize(jpeg)
    const shown = liveFrameSize.get()
    if (size && (shown?.width !== size.width || shown.height !== size.height)) liveFrameSize.set(size)
    const blob = new Blob([jpeg as BlobPart], { type: 'image/jpeg' })
    if (current) retired.push(current.url)
    while (retired.length > RETIRED_URLS_KEPT) URL.revokeObjectURL(retired.shift()!)
    current = { blob, url: URL.createObjectURL(blob) }
    listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** Every new frame, outside React (the GPU uploads it as it arrives). */
export function subscribeToLiveFrames(listener: (frame: LiveFrame | null) => void): () => void {
    return subscribe(() => listener(current))
}

export function useLiveFrame(): LiveFrame | null {
    return useSyncExternalStore(subscribe, () => current)
}

/** True once any frame has arrived; changes once, so callers don't re-render per frame. */
export function useHasLiveFrame(): boolean {
    return useSyncExternalStore(subscribe, () => current !== null)
}

/** The camera's focus, face and eye frames: they move with the subject, often every frame, so they live here too. */
const focusFrameListeners = new Set<() => void>()
let currentFocusFrames: FocusFrame[] = []

export function publishFocusFrames(frames: FocusFrame[]): void {
    currentFocusFrames = frames
    focusFrameListeners.forEach(listener => listener())
}

function subscribeToFocusFrames(listener: () => void): () => void {
    focusFrameListeners.add(listener)
    return () => focusFrameListeners.delete(listener)
}

export function useFocusFrames(): FocusFrame[] {
    return useSyncExternalStore(subscribeToFocusFrames, () => currentFocusFrames)
}
