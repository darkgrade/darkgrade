import { SRGBColorSpace, WebGLRenderer } from 'three'

import { linkScene } from '@/app/components/scenes/link-scene'
import { type Model, type ModelName, loadModel } from '@/app/components/scenes/load-model'
import { viewportSize } from '@/app/components/scenes/materials'
import type { Stage } from '@/app/components/scenes/staging'
import { studioScene } from '@/app/components/scenes/studio-scene'

export type SceneName = 'link' | 'studio'

const SCENES: Record<SceneName, { model: ModelName; build: (model: Model) => Stage }> = {
    link: { model: 'camera', build: linkScene },
    studio: { model: 'studio', build: studioScene },
}

const MAXIMUM_PIXEL_RATIO = 2
/** The longest step time takes in one frame, so a scene does not leap after the tab was in the background. */
const LONGEST_FRAME_SECONDS = 0.1
/** The moment held for visitors who ask for reduced motion: mid-move, so the drawing shows what it does. */
const STILL_SECONDS = 3.2

/**
 * Draws a scene on a canvas for as long as it is on screen, and returns how to stop.
 * The model is fetched the first time the canvas nears the window, not with the page.
 */
export function runScene(canvas: HTMLCanvasElement, name: SceneName): () => void {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let stage: Stage | undefined
    let requested = false
    let visible = false
    let stopped = false
    let seconds = still ? STILL_SECONDS : 0
    let lastFrameMilliseconds = 0
    let frame = 0

    function draw() {
        if (!stage) return
        const pixelRatio = Math.min(devicePixelRatio, MAXIMUM_PIXEL_RATIO)
        const width = Math.round(canvas.clientWidth * pixelRatio)
        const height = Math.round(canvas.clientHeight * pixelRatio)
        if (width === 0 || height === 0) return
        if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false)
        stage.camera.aspect = width / height
        stage.camera.updateProjectionMatrix()
        stage.update(seconds)
        viewportSize.value.set(width, height)
        renderer.render(stage.scene, stage.camera)
    }

    function tick(milliseconds: number) {
        if (stopped || !visible) return
        seconds += Math.min((milliseconds - lastFrameMilliseconds) / 1000, LONGEST_FRAME_SECONDS)
        lastFrameMilliseconds = milliseconds
        draw()
        frame = requestAnimationFrame(tick)
    }

    function start() {
        if (stopped || !visible || !stage) return
        if (still) return draw()
        cancelAnimationFrame(frame)
        lastFrameMilliseconds = performance.now()
        frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(
        ([entry]) => {
            visible = entry?.isIntersecting ?? false
            if (!visible) return
            if (requested) return start()
            requested = true
            const { model, build } = SCENES[name]
            loadModel(model).then(loaded => {
                if (stopped) return
                stage = build(loaded)
                start()
            }, () => {})
        },
        { rootMargin: '200px' },
    )
    observer.observe(canvas)
    const resized = new ResizeObserver(() => still && draw())
    resized.observe(canvas)

    return () => {
        stopped = true
        cancelAnimationFrame(frame)
        observer.disconnect()
        resized.disconnect()
        renderer.dispose()
    }
}
