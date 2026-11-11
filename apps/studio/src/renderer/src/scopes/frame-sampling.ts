import { useLiveFrame } from '@renderer/lib/live-frame-store'
import { useEffect, useRef } from 'react'

/** Live frames are read at this width; scopes need distribution, not detail. */
const SAMPLE_WIDTH = 240
/** Fraction of the remaining distance each drawn frame moves toward the latest measurement. */
export const EASING_PER_FRAME = 0.22
/** Scopes redraw at most this often, a little under 30 fps so no live frame is missed. */
const SCOPE_DRAW_INTERVAL_MS = 30

export interface FrameSample {
    pixels: Uint8ClampedArray
    width: number
    height: number
}

/**
 * Hands the pixels of each new live-view frame, shrunk to a small width, to onSample. Decoding and
 * shrinking happen off the main thread, and a frame that arrives mid-decode is skipped rather than
 * queued. Calls onSample(null) when live view stops, so scopes can fall flat.
 */
export function useFrameSamples(active: boolean, onSample: (sample: FrameSample | null) => void): void {
    const frame = useLiveFrame()
    const samplerRef = useRef<OffscreenCanvas | null>(null)
    const decodingRef = useRef(false)
    const onSampleRef = useRef(onSample)
    onSampleRef.current = onSample

    useEffect(() => {
        if (!active || !frame) {
            onSampleRef.current(null)
            return
        }
        if (decodingRef.current) return
        decodingRef.current = true
        void createImageBitmap(frame.blob, { resizeWidth: SAMPLE_WIDTH, resizeQuality: 'low' })
            .then(bitmap => {
                const sampler = (samplerRef.current ??= new OffscreenCanvas(bitmap.width, bitmap.height))
                sampler.width = bitmap.width
                sampler.height = bitmap.height
                const context = sampler.getContext('2d', { willReadFrequently: true })
                context?.drawImage(bitmap, 0, 0)
                bitmap.close()
                if (!context) return
                const { data } = context.getImageData(0, 0, sampler.width, sampler.height)
                onSampleRef.current({ pixels: data, width: sampler.width, height: sampler.height })
            })
            .catch(() => {})
            .finally(() => {
                decodingRef.current = false
            })
    }, [active, frame])
}

/** Moves every value in shown a step toward target; instant when the viewer prefers reduced motion. */
export function easeToward(shown: Float32Array, target: Float32Array, easing: number): void {
    for (let index = 0; index < shown.length; index++) shown[index] += (target[index] - shown[index]) * easing
}

/**
 * Runs draw on every animation frame against a canvas sized to its CSS box at device resolution.
 * The easing passed to draw is already adjusted for reduced motion.
 */
export function useScopeCanvas(
    draw: (context: CanvasRenderingContext2D, width: number, height: number, easing: number) => void
): React.RefObject<HTMLCanvasElement | null> {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const drawRef = useRef(draw)
    drawRef.current = draw

    useEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        let animationFrame = 0
        let lastDrawMs = 0
        const frame = (now: number): void => {
            animationFrame = requestAnimationFrame(frame)
            // Frames arrive at 30 fps at most; redrawing at a 120 Hz display's rate only burns power.
            if (now - lastDrawMs < SCOPE_DRAW_INTERVAL_MS) return
            lastDrawMs = now
            const pixelRatio = window.devicePixelRatio || 1
            const width = canvas.clientWidth
            const height = canvas.clientHeight
            if (width === 0 || height === 0) return
            if (canvas.width !== Math.round(width * pixelRatio)) canvas.width = Math.round(width * pixelRatio)
            if (canvas.height !== Math.round(height * pixelRatio)) canvas.height = Math.round(height * pixelRatio)
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
            context.clearRect(0, 0, width, height)
            drawRef.current(context, width, height, reduceMotion ? 1 : EASING_PER_FRAME)
        }
        animationFrame = requestAnimationFrame(frame)
        return () => cancelAnimationFrame(animationFrame)
    }, [])

    return canvasRef
}

/** One shared look for every scope: a rounded dark panel with no border. */
export const SCOPE_CANVAS_CLASS = 'w-full rounded-lg bg-black/50'

/** Faint guide lines, as Resolve draws its graticule. */
export const GRATICULE_COLOR = 'rgb(255 255 255 / 0.09)'
