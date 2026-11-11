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

export function publishLiveFrame(jpeg: Uint8Array): void {
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
