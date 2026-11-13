import { MathUtils, Quaternion, SRGBColorSpace, Vector3, WebGLRenderer } from 'three'

import { linkScene } from '@/app/components/scenes/link-scene'
import { type Model, type ModelName, loadModel } from '@/app/components/scenes/load-model'
import { viewportSize } from '@/app/components/scenes/materials'
import type { Stage } from '@/app/components/scenes/staging'
import { studioScene } from '@/app/components/scenes/studio-scene'

export type SceneName = 'link' | 'studio'

/**
 * How many times wider and taller than its frame the canvas is. The drawing is free to spill past
 * the frame it is laid out in, so nothing is cut off at the frame's edge.
 */
export const CANVAS_OVER_FRAME = 1.8

const SCENES: Record<SceneName, { model: ModelName; build: (model: Model) => Stage }> = {
    link: { model: 'camera', build: linkScene },
    studio: { model: 'studio', build: studioScene },
}

/** How large the drawing is against the size that just fits its frame. */
const DRAWING_SCALE = 1.5
const MAXIMUM_PIXEL_RATIO = 2
/** The longest step time takes in one frame, so a scene does not leap after the tab was in the background. */
const LONGEST_FRAME_SECONDS = 0.1
/** The moment held for visitors who ask for reduced motion: mid-move, so the drawing shows what it does. */
const STILL_SECONDS = 3.2
const DRAG_RADIANS_PER_PIXEL = 0.008
/** How far a drag may tip the view up or down from the isometric angle, in radians. */
const MAXIMUM_TIP_RADIANS = 0.45
const WORLD_UP = new Vector3(0, 1, 0)

/** Where the camera stands before any drag, and how far the visitor has turned the view since. */
interface View {
    position: Vector3
    orientation: Quaternion
    turn: number
    tip: number
}

const fromTarget = new Vector3()
const sideways = new Vector3()

/** Stands the camera where the visitor's drag has turned it to, about the point it looks at. */
function turnTheView(stage: Stage, view: View) {
    stage.camera.position.copy(view.position)
    stage.camera.quaternion.copy(view.orientation)
    if (view.turn === 0 && view.tip === 0) return
    fromTarget.copy(view.position).sub(stage.target).applyAxisAngle(WORLD_UP, view.turn)
    sideways.crossVectors(WORLD_UP, fromTarget).normalize()
    fromTarget.applyAxisAngle(sideways, view.tip)
    stage.camera.position.copy(stage.target).add(fromTarget)
    stage.camera.lookAt(stage.target)
}

/**
 * Draws a scene on a canvas for as long as it is on screen, and returns how to stop. Dragging on
 * `frame` turns the view about the drawing. The model is fetched the first time the canvas nears
 * the window, not with the page.
 */
export function runScene(canvas: HTMLCanvasElement, frame: HTMLElement, name: SceneName): () => void {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const view: View = { position: new Vector3(), orientation: new Quaternion(), turn: 0, tip: 0 }
    const listening = new AbortController()
    let stage: Stage | undefined
    let requested = false
    let visible = false
    let stopped = false
    let seconds = still ? STILL_SECONDS : 0
    let lastFrameMilliseconds = 0
    let animationFrame = 0
    let dragFrom: { x: number; y: number } | undefined

    function draw() {
        if (!stage) return
        const pixelRatio = Math.min(devicePixelRatio, MAXIMUM_PIXEL_RATIO)
        const width = Math.round(canvas.clientWidth * pixelRatio)
        const height = Math.round(canvas.clientHeight * pixelRatio)
        if (width === 0 || height === 0) return
        if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false)
        stage.update(seconds)
        turnTheView(stage, view)
        stage.camera.aspect = width / height
        stage.camera.zoom = DRAWING_SCALE / CANVAS_OVER_FRAME
        stage.camera.updateProjectionMatrix()
        viewportSize.value.set(width, height)
        renderer.render(stage.scene, stage.camera)
    }

    function tick(milliseconds: number) {
        if (stopped || !visible) return
        seconds += Math.min((milliseconds - lastFrameMilliseconds) / 1000, LONGEST_FRAME_SECONDS)
        lastFrameMilliseconds = milliseconds
        draw()
        animationFrame = requestAnimationFrame(tick)
    }

    function start() {
        if (stopped || !visible || !stage) return
        if (still) return draw()
        cancelAnimationFrame(animationFrame)
        lastFrameMilliseconds = performance.now()
        animationFrame = requestAnimationFrame(tick)
    }

    function drag(event: PointerEvent) {
        if (!dragFrom) return
        view.turn -= (event.clientX - dragFrom.x) * DRAG_RADIANS_PER_PIXEL
        view.tip = MathUtils.clamp(view.tip - (event.clientY - dragFrom.y) * DRAG_RADIANS_PER_PIXEL, -MAXIMUM_TIP_RADIANS, MAXIMUM_TIP_RADIANS)
        dragFrom = { x: event.clientX, y: event.clientY }
        if (still) draw()
    }

    const { signal } = listening
    frame.addEventListener(
        'pointerdown',
        event => {
            dragFrom = { x: event.clientX, y: event.clientY }
            frame.setPointerCapture(event.pointerId)
        },
        { signal },
    )
    frame.addEventListener('pointermove', drag, { signal })
    for (const ending of ['pointerup', 'pointercancel'] as const) frame.addEventListener(ending, () => (dragFrom = undefined), { signal })

    const observer = new IntersectionObserver(
        ([entry]) => {
            visible = entry?.isIntersecting ?? false
            if (!visible) return
            if (requested) return start()
            requested = true
            const { model, build } = SCENES[name]
            loadModel(model).then(
                loaded => {
                    if (stopped) return
                    stage = build(loaded)
                    view.position.copy(stage.camera.position)
                    view.orientation.copy(stage.camera.quaternion)
                    start()
                },
                () => {},
            )
        },
        { rootMargin: '200px' },
    )
    observer.observe(canvas)
    const resized = new ResizeObserver(() => still && draw())
    resized.observe(canvas)

    return () => {
        stopped = true
        cancelAnimationFrame(animationFrame)
        listening.abort()
        observer.disconnect()
        resized.disconnect()
        renderer.dispose()
    }
}
