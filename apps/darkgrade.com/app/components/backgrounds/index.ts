import type { BgMode } from '../background-mode'
import { createContours, type ContourRenderer } from './contours'
import { CONTOUR_BACKGROUND_ENABLED, CONTOUR_OPACITY, CROSSFADE_SECONDS } from './field'
import { createSilk, type SilkRenderer } from './silk'

export type BackgroundLayers = {
    /** False when WebGL is unavailable; the caller should fall back to contours. */
    readonly silkAvailable: boolean
    /** The intro ramp on the silk. GSAP tweens this directly. */
    readonly intro: { value: number }
    setMode(mode: BgMode): void
    setScroll(v: number): void
    setPointer(clientX: number, clientY: number): void
    resize(): void
    start(): void
    stop(): void
    destroy(): void
}

/**
 * Runs both backdrops off one clock and cross-fades between them.
 *
 * The clock is why the swap is seamless: neither renderer keeps its own notion
 * of elapsed time, so a layer that has been parked while faded out resumes at
 * exactly the phase it would have reached had it been drawing the whole time.
 * Time accumulates only while we render, so a hidden tab never fast-forwards
 * on resume the way a wall-clock timer would.
 */
export function createBackgrounds(
    silkCanvas: HTMLCanvasElement,
    contourCanvas: HTMLCanvasElement | null
): BackgroundLayers {
    const silk: SilkRenderer | null = createSilk(silkCanvas)
    const contours: ContourRenderer | null =
        CONTOUR_BACKGROUND_ENABLED && contourCanvas ? createContours(contourCanvas) : null
    if (!silk) silkCanvas.style.display = 'none'
    if (!contours && contourCanvas) contourCanvas.style.display = 'none'

    let mode: BgMode = silk || !contours ? 'silk' : 'contours'
    // 1 = all silk, 0 = all contours. Moves linearly over CROSSFADE_SECONDS.
    let mix = mode === 'silk' ? 1 : 0
    let scroll = 0
    // normalised for the shader; raw CSS px for the contour grid
    let pointerNX = 0.5
    let pointerNY = 0.5
    let pointerX = -99
    let pointerY = -99

    let raf = 0
    let running = false
    let t = 0
    let last = 0

    const frame = () => {
        raf = requestAnimationFrame(frame)
        const now = performance.now()
        const dt = Math.min(now - last, 100) / 1000
        last = now
        t += dt

        const target = mode === 'silk' ? 1 : 0
        if (mix !== target) {
            const step = dt / CROSSFADE_SECONDS
            mix = target > mix ? Math.min(target, mix + step) : Math.max(target, mix - step)
        }
        // smoothstep the linear progress so both ends of the fade ease
        const e = mix * mix * (3 - 2 * mix)
        const silkAlpha = silk ? e : 0
        const contourAlpha = contours ? (1 - e) * CONTOUR_OPACITY : 0

        silkCanvas.style.opacity = String(silkAlpha)
        if (contourCanvas) contourCanvas.style.opacity = String(contourAlpha)

        // only pay for a layer that is actually contributing pixels
        if (silk && silkAlpha > 0.001) silk.draw(t, pointerNX, pointerNY, scroll)
        if (contours && contourAlpha > 0.001) contours.draw(t, pointerX, pointerY)
    }

    return {
        silkAvailable: Boolean(silk),
        intro: silk ? silk.fade : { value: 0 },
        setMode(next) {
            if (!silk && next === 'silk') return
            if (!contours && next === 'contours') return
            mode = next
        },
        setScroll(v) {
            scroll = v
        },
        setPointer(clientX, clientY) {
            pointerNX = clientX / innerWidth
            pointerNY = 1 - clientY / innerHeight
            pointerX = clientX
            pointerY = clientY
        },
        resize() {
            silk?.resize()
            contours?.resize()
        },
        start() {
            if (running) return
            running = true
            last = performance.now()
            raf = requestAnimationFrame(frame)
        },
        stop() {
            if (!running) return
            running = false
            cancelAnimationFrame(raf)
        },
        destroy() {
            this.stop()
            silk?.destroy()
            contours?.destroy()
        },
    }
}
