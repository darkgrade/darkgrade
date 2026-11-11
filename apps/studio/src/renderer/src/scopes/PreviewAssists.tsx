import type { PreviewAssistSettings } from '@renderer/scopes/preview-assists-painting'
import { useLiveFrame } from '@renderer/lib/live-frame-store'
import { useEffect, useRef } from 'react'

/** At most this often; frames in between are skipped. */
const ANALYSIS_INTERVAL_MS = 1000 / 12

export { DEFAULT_PREVIEW_ASSISTS, type PreviewAssistSettings } from '@renderer/scopes/preview-assists-painting'

/** One frame for the worker to analyse. */
export interface PreviewAssistsRequest {
    frameUrl: string
    settings: PreviewAssistSettings
}

/** What the window sends the worker: the canvas to draw on (once), then frames. */
export type PreviewAssistsMessage = { type: 'canvas'; canvas: OffscreenCanvas } | ({ type: 'frame' } & PreviewAssistsRequest)

/**
 * Zebras and focus peaking drawn over the live preview by Studio, from the preview stream itself;
 * the camera's own zebra and peaking settings are left alone. The analysis runs in a worker and
 * skips to the newest frame whenever it falls behind, so live view keeps its frame rate.
 */
export function PreviewAssistsOverlay({ settings }: { settings: PreviewAssistSettings }): React.JSX.Element {
    const frameUrl = useLiveFrame()?.url ?? null
    const wrapperRef = useRef<HTMLDivElement>(null)
    const workerRef = useRef<Worker | null>(null)
    const busyRef = useRef(false)
    const pendingRef = useRef<PreviewAssistsRequest | null>(null)
    const lastSentMsRef = useRef(0)

    useEffect(() => {
        const wrapper = wrapperRef.current
        if (!wrapper) return
        const worker = new Worker(new URL('./preview-assists.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
        // A canvas can be handed to a worker only once, so each worker gets a canvas of its own.
        const canvas = document.createElement('canvas')
        canvas.className = 'size-full'
        wrapper.replaceChildren(canvas)
        const offscreen = canvas.transferControlToOffscreen()
        worker.postMessage({ type: 'canvas', canvas: offscreen } satisfies PreviewAssistsMessage, [offscreen])
        // A fresh worker owes no answer: a frame sent to a terminated one must not hold the queue.
        busyRef.current = false
        worker.onmessage = () => {
            busyRef.current = false
            if (!pendingRef.current) return
            const waitMs = Math.max(0, ANALYSIS_INTERVAL_MS - (performance.now() - lastSentMsRef.current))
            setTimeout(() => {
                const next = pendingRef.current
                pendingRef.current = null
                if (next && workerRef.current) send(next)
            }, waitMs)
        }
        return () => {
            worker.terminate()
            workerRef.current = null
            canvas.remove()
        }
    }, [])

    const send = (request: PreviewAssistsRequest): void => {
        if (!workerRef.current) return
        lastSentMsRef.current = performance.now()
        busyRef.current = true
        workerRef.current.postMessage({ type: 'frame', ...request } satisfies PreviewAssistsMessage)
    }

    useEffect(() => {
        if (!frameUrl) return
        const request = { frameUrl, settings }
        // Twelve analyses a second read the same on screen as thirty, and leave the GPU and memory
        // bandwidth to the live view and the local models.
        const sinceLastMs = performance.now() - lastSentMsRef.current
        if (busyRef.current || sinceLastMs < ANALYSIS_INTERVAL_MS) pendingRef.current = request
        else send(request)
    }, [frameUrl, settings])

    return <div ref={wrapperRef} className="pointer-events-none absolute inset-0" aria-hidden />
}
