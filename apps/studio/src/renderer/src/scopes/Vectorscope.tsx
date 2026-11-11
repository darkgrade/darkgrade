import {
    easeToward,
    GRATICULE_COLOR,
    SCOPE_CANVAS_CLASS,
    useFrameSamples,
    useScopeCanvas,
    type FrameSample,
} from '@renderer/scopes/frame-sampling'
import { useRef } from 'react'

const GRID = 120
/** Chroma at the edge of the circle; ±0.5 is fully saturated in BT.709 Cb/Cr. */
const CHROMA_RANGE = 0.5
const GAIN = 22
/** Resolve's skin-tone line sits about 123° counter-clockwise from the +Cb axis. */
const SKIN_TONE_DEGREES = 123

/** BT.709 colour difference: blue (x) and red (y) relative to luma, each in −0.5…0.5. */
function chroma(red: number, green: number, blue: number): [number, number] {
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return [(blue - luma) / 1.8556, (red - luma) / 1.5748]
}

const TARGETS = (
    [
        ['R', [0.75, 0, 0]],
        ['Mg', [0.75, 0, 0.75]],
        ['B', [0, 0, 0.75]],
        ['Cy', [0, 0.75, 0.75]],
        ['G', [0, 0.75, 0]],
        ['Yl', [0.75, 0.75, 0]],
    ] as const
).map(([label, [red, green, blue]]) => ({ label, chroma: chroma(red, green, blue) }))

/**
 * Where each pixel's hue and saturation fall, binned on a square grid. Each cell keeps its density
 * and the average colour of the pixels in it, so the trace shows the picture's own colours.
 */
function measure(sample: FrameSample | null): Float32Array {
    const cells = new Float32Array(GRID * GRID * 4)
    if (!sample) return cells
    const { pixels } = sample
    for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] / 255
        const green = pixels[index + 1] / 255
        const blue = pixels[index + 2] / 255
        const [cb, cr] = chroma(red, green, blue)
        const column = Math.floor(((cb / CHROMA_RANGE + 1) / 2) * (GRID - 1))
        const row = Math.floor(((1 - cr / CHROMA_RANGE) / 2) * (GRID - 1))
        if (column < 0 || column >= GRID || row < 0 || row >= GRID) continue
        const cell = (row * GRID + column) * 4
        cells[cell] += 1
        cells[cell + 1] += red
        cells[cell + 2] += green
        cells[cell + 3] += blue
    }
    const pixelCount = pixels.length / 4
    for (let cell = 0; cell < cells.length; cell += 4) {
        const count = cells[cell]
        if (count === 0) continue
        // Average colour, pushed to full brightness so dim pixels still show their hue.
        const red = cells[cell + 1] / count
        const green = cells[cell + 2] / count
        const blue = cells[cell + 3] / count
        const brightest = Math.max(red, green, blue, 0.001)
        cells[cell] = Math.min(1, Math.pow((count / pixelCount) * GAIN * GRID, 0.5))
        cells[cell + 1] = red / brightest
        cells[cell + 2] = green / brightest
        cells[cell + 3] = blue / brightest
    }
    return cells
}

/** Live vectorscope of the camera feed with Resolve's targets and skin-tone line. */
export function Vectorscope({ frameUrl }: { frameUrl: string | null }): React.JSX.Element {
    const target = useRef<Float32Array>(new Float32Array(GRID * GRID * 4))
    const shown = useRef<Float32Array>(new Float32Array(GRID * GRID * 4))
    const traceRef = useRef<HTMLCanvasElement | null>(null)
    useFrameSamples(frameUrl, sample => {
        target.current = measure(sample)
    })

    const canvasRef = useScopeCanvas((context, width, height, easing) => {
        easeToward(shown.current, target.current, easing)
        const size = Math.min(width, height) - 12
        const centreX = width / 2
        const centreY = height / 2
        const radius = size / 2
        const toCanvas = ([cb, cr]: readonly [number, number]): [number, number] => [
            centreX + (cb / CHROMA_RANGE) * radius,
            centreY - (cr / CHROMA_RANGE) * radius,
        ]

        context.strokeStyle = GRATICULE_COLOR
        context.lineWidth = 1
        context.beginPath()
        context.arc(centreX, centreY, radius, 0, Math.PI * 2)
        context.moveTo(centreX - radius, centreY)
        context.lineTo(centreX + radius, centreY)
        context.moveTo(centreX, centreY - radius)
        context.lineTo(centreX, centreY + radius)
        context.stroke()

        const skinAngle = (SKIN_TONE_DEGREES * Math.PI) / 180
        context.strokeStyle = 'rgb(255 255 255 / 0.16)'
        context.beginPath()
        context.moveTo(centreX, centreY)
        context.lineTo(centreX + Math.cos(skinAngle) * radius, centreY - Math.sin(skinAngle) * radius)
        context.stroke()

        context.font = '9px var(--font-sans), sans-serif'
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        for (const { label, chroma: point } of TARGETS) {
            const [x, y] = toCanvas(point)
            context.strokeStyle = 'rgb(255 255 255 / 0.22)'
            context.beginPath()
            context.roundRect(x - 5, y - 5, 10, 10, 2)
            context.stroke()
            context.fillStyle = 'rgb(255 255 255 / 0.35)'
            const outward = Math.hypot(x - centreX, y - centreY) || 1
            context.fillText(label, x + ((x - centreX) / outward) * 13, y + ((y - centreY) / outward) * 13)
        }

        const trace = (traceRef.current ??= document.createElement('canvas'))
        trace.width = GRID
        trace.height = GRID
        const traceContext = trace.getContext('2d')
        if (!traceContext) return
        const image = traceContext.createImageData(GRID, GRID)
        for (let cell = 0; cell < GRID * GRID; cell++) {
            const density = shown.current[cell * 4]
            // Dense areas wash toward white, as a busy trace does on a hardware scope.
            const wash = density * density * 0.3
            image.data[cell * 4] = Math.round(255 * Math.min(1, shown.current[cell * 4 + 1] + wash))
            image.data[cell * 4 + 1] = Math.round(255 * Math.min(1, shown.current[cell * 4 + 2] + wash))
            image.data[cell * 4 + 2] = Math.round(255 * Math.min(1, shown.current[cell * 4 + 3] + wash))
            image.data[cell * 4 + 3] = Math.round(255 * density)
        }
        traceContext.putImageData(image, 0, 0)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        // A slight soften turns the binned grid into a continuous, glowing trace.
        context.filter = 'blur(0.7px)'
        context.globalCompositeOperation = 'lighter'
        context.drawImage(trace, centreX - radius, centreY - radius, radius * 2, radius * 2)
        context.globalCompositeOperation = 'source-over'
        context.filter = 'none'
    })

    return (
        <canvas
            ref={canvasRef}
            className={`${SCOPE_CANVAS_CLASS} aspect-square`}
            role="img"
            aria-label="Live vectorscope"
        />
    )
}
