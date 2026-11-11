import { useEffect, useRef } from 'react'

/** Live frames are read at this width; scopes need distribution, not detail. */
const SAMPLE_WIDTH = 240
/** Fraction of the remaining distance each drawn frame moves toward the latest measurement. */
export const EASING_PER_FRAME = 0.22

export interface FrameSample {
    pixels: Uint8ClampedArray
    width: number
    height: number
}

/**
 * Decodes each new live-view frame onto a small offscreen canvas and hands its pixels to
 * onSample. Calls onSample(null) when there is no frame, so scopes can fall flat.
 */
export function useFrameSamples(frameUrl: string | null, onSample: (sample: FrameSample | null) => void): void {
    const samplerRef = useRef<HTMLCanvasElement | null>(null)
    const onSampleRef = useRef(onSample)
    onSampleRef.current = onSample

    useEffect(() => {
        if (!frameUrl) {
            onSampleRef.current(null)
            return
        }
        let cancelled = false
        const image = new Image()
        image.onload = () => {
            if (cancelled || image.naturalWidth === 0) return
            const sampler = (samplerRef.current ??= document.createElement('canvas'))
            sampler.width = SAMPLE_WIDTH
            sampler.height = Math.max(1, Math.round((SAMPLE_WIDTH * image.naturalHeight) / image.naturalWidth))
            const context = sampler.getContext('2d', { willReadFrequently: true })
            if (!context) return
            context.drawImage(image, 0, 0, sampler.width, sampler.height)
            const { data } = context.getImageData(0, 0, sampler.width, sampler.height)
            onSampleRef.current({ pixels: data, width: sampler.width, height: sampler.height })
        }
        image.src = frameUrl
        return () => {
            cancelled = true
        }
    }, [frameUrl])
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
        const frame = (): void => {
            animationFrame = requestAnimationFrame(frame)
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
        frame()
        return () => cancelAnimationFrame(animationFrame)
    }, [])

    return canvasRef
}

/** One shared look for every scope: a rounded dark panel with no border. */
export const SCOPE_CANVAS_CLASS = 'w-full rounded-lg bg-black/50'

/** Faint guide lines, as Resolve draws its graticule. */
export const GRATICULE_COLOR = 'rgb(255 255 255 / 0.09)'
