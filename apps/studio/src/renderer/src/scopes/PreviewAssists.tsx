import type { PreviewAssistSettings } from '@renderer/scopes/preview-assists-painting'
import { useEffect, useRef } from 'react'

export { DEFAULT_PREVIEW_ASSISTS, type PreviewAssistSettings } from '@renderer/scopes/preview-assists-painting'

/** One frame for the worker to analyse. */
export interface PreviewAssistsRequest {
    frameUrl: string
    settings: PreviewAssistSettings
}

/**
 * Zebras and focus peaking drawn over the live preview by Studio, from the preview stream itself;
 * the camera's own zebra and peaking settings are left alone. The analysis runs in a worker and
 * skips to the newest frame whenever it falls behind, so live view keeps its frame rate.
 */
export function PreviewAssistsOverlay({
    frameUrl,
    settings,
}: {
    frameUrl: string
    settings: PreviewAssistSettings
}): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const workerRef = useRef<Worker | null>(null)
    const busyRef = useRef(false)
    const pendingRef = useRef<PreviewAssistsRequest | null>(null)

    useEffect(() => {
        const worker = new Worker(new URL('./preview-assists.worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker
        // A fresh worker owes no answer: a frame sent to a terminated one must not hold the queue.
        busyRef.current = false
        worker.onmessage = (event: MessageEvent<ImageData | null>) => {
            busyRef.current = false
            const canvas = canvasRef.current
            const overlay = event.data
            if (canvas && overlay) {
                canvas.width = overlay.width
                canvas.height = overlay.height
                canvas.getContext('2d')?.putImageData(overlay, 0, 0)
            }
            const next = pendingRef.current
            pendingRef.current = null
            if (next) send(next)
        }
        return () => {
            worker.terminate()
            workerRef.current = null
        }
    }, [])

    const send = (request: PreviewAssistsRequest): void => {
        if (!workerRef.current) return
        busyRef.current = true
        workerRef.current.postMessage(request)
    }

    useEffect(() => {
        const request = { frameUrl, settings }
        if (busyRef.current) pendingRef.current = request
        else send(request)
    }, [frameUrl, settings])

    return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
}
