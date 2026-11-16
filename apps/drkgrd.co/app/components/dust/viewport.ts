import { SRGBColorSpace, Vector2, WebGLRenderer } from 'three'

/** darkgrade.com shares this with its line materials; the dust alone has no one to tell. */
const viewportSize = { value: new Vector2(800, 600) }

/** What a scene is told each time it is drawn. */
export interface Frame {
    /** Seconds the scene has been on screen, which stand still for visitors who ask for reduced motion. */
    seconds: number
    /** Seconds since the last frame: never less than none, never more than a tenth. */
    deltaSeconds: number
    /** The canvas, in device pixels. */
    width: number
    height: number
    /** The canvas, in CSS pixels. */
    cssWidth: number
    cssHeight: number
    /** The pointer over the canvas: -1..1 across and -1..1 down, from its middle. Stays where it last was. */
    pointer: Vector2
    /** Whether the pointer has ever moved over the page. */
    pointerSeen: boolean
    /** True for visitors who ask for reduced motion: move only what scrolling or the pointer moves. */
    still: boolean
}

/** A scene a viewport draws: it renders itself, so it may draw several passes. */
export interface ViewportScene {
    draw(frame: Frame, renderer: WebGLRenderer): void
    dispose?(): void
}

export interface ViewportOptions {
    /** Device pixels a CSS pixel at most; 2 unless given. Full-window scenes are cheaper at 1.5. Given the canvas's size in CSS pixels, it may answer differently for different windows. */
    maximumPixelRatio?: number | ((cssWidth: number, cssHeight: number) => number)
    antialias?: boolean
    /** Keep the last frame readable, for scenes that are copied or sampled. */
    preserveDrawingBuffer?: boolean
    /** Called once the scene has been built and drawn for the first time. */
    onReady?: () => void
}

const LONGEST_FRAME_SECONDS = 0.1

/**
 * Draws a scene on a canvas for as long as it is on screen and the tab is in front, and returns
 * how to stop. `build` may fetch models: nothing is drawn until it resolves.
 */
export function runViewport(
    canvas: HTMLCanvasElement,
    build: (renderer: WebGLRenderer) => ViewportScene | Promise<ViewportScene>,
    options: ViewportOptions = {}
): () => void {
    const renderer = new WebGLRenderer({
        canvas,
        antialias: options.antialias ?? true,
        alpha: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
    })
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setClearColor(0x000000, 0)
    renderer.localClippingEnabled = true

    const maximumPixelRatio = options.maximumPixelRatio ?? 2
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const listening = new AbortController()
    const frame: Frame = {
        seconds: 0,
        deltaSeconds: 0,
        width: 1,
        height: 1,
        cssWidth: 1,
        cssHeight: 1,
        pointer: new Vector2(),
        pointerSeen: false,
        still,
    }
    let scene: ViewportScene | undefined
    let onScreen = false
    let stopped = false
    let animationFrame = 0
    let lastMilliseconds = 0
    let announced = false

    function tick(milliseconds: number) {
        animationFrame = 0
        if (stopped || !onScreen || !scene) return
        const bounds = canvas.getBoundingClientRect()
        const most =
            typeof maximumPixelRatio === 'number' ? maximumPixelRatio : maximumPixelRatio(bounds.width, bounds.height)
        const pixelRatio = Math.min(devicePixelRatio, most)
        const width = Math.round(bounds.width * pixelRatio)
        const height = Math.round(bounds.height * pixelRatio)
        if (width > 0 && height > 0) {
            if (canvas.width !== width || canvas.height !== height) renderer.setSize(width, height, false)
            // A frame's own time can be a hair earlier than the moment the viewport was started, which would make the first step run backwards.
            frame.deltaSeconds = Math.max(0, Math.min((milliseconds - lastMilliseconds) / 1000, LONGEST_FRAME_SECONDS))
            if (!still) frame.seconds += frame.deltaSeconds
            frame.width = width
            frame.height = height
            frame.cssWidth = bounds.width
            frame.cssHeight = bounds.height
            viewportSize.value.set(width, height)
            scene.draw(frame, renderer)
            if (!announced) {
                announced = true
                options.onReady?.()
            }
        }
        lastMilliseconds = milliseconds
        animationFrame = requestAnimationFrame(tick)
    }

    function start() {
        if (animationFrame || stopped || !onScreen || !scene || document.hidden) return
        lastMilliseconds = performance.now()
        animationFrame = requestAnimationFrame(tick)
    }

    const { signal } = listening
    addEventListener(
        'pointermove',
        event => {
            const bounds = canvas.getBoundingClientRect()
            frame.pointer.set(
                ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
                ((event.clientY - bounds.top) / bounds.height) * 2 - 1
            )
            frame.pointerSeen = true
        },
        { signal, passive: true }
    )
    document.addEventListener('visibilitychange', start, { signal })

    const observer = new IntersectionObserver(
        ([entry]) => {
            onScreen = entry?.isIntersecting ?? false
            start()
        },
        { rootMargin: '120px' }
    )
    observer.observe(canvas)

    void Promise.resolve(build(renderer)).then(
        built => {
            if (stopped) return built.dispose?.()
            scene = built
            start()
        },
        (error: unknown) => console.error('The scene could not be built', error)
    )

    return () => {
        stopped = true
        cancelAnimationFrame(animationFrame)
        listening.abort()
        observer.disconnect()
        scene?.dispose?.()
        renderer.dispose()
    }
}
