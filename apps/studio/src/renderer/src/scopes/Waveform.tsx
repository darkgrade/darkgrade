import {
    easeToward,
    GRATICULE_COLOR,
    SCOPE_CANVAS_CLASS,
    useFrameSamples,
    useScopeCanvas,
    type FrameSample,
} from '@renderer/scopes/frame-sampling'
import { useRef } from 'react'

const COLUMNS = 160
const ROWS = 100
/** How strongly a busy cell lights up; higher brightens faint traces. */
const GAIN = 14
const PADDING_PX = 6

/**
 * RGB overlay waveform as Resolve draws it: for each column of the picture, where its red, green
 * and blue values sit from black (bottom) to white (top). Stored as intensity per channel per cell.
 */
function measure(sample: FrameSample | null): Float32Array {
    const intensity = new Float32Array(COLUMNS * ROWS * 3)
    if (!sample) return intensity
    const { pixels, width, height } = sample
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const pixel = (y * width + x) * 4
            const column = Math.min(COLUMNS - 1, Math.floor((x * COLUMNS) / width))
            for (let channel = 0; channel < 3; channel++) {
                const row = ROWS - 1 - Math.min(ROWS - 1, Math.floor((pixels[pixel + channel] * ROWS) / 256))
                intensity[(row * COLUMNS + column) * 3 + channel]++
            }
        }
    }
    const pixelsPerColumn = (width * height) / COLUMNS
    for (let index = 0; index < intensity.length; index++) {
        intensity[index] = Math.min(1, Math.pow((intensity[index] / pixelsPerColumn) * GAIN, 0.6))
    }
    return intensity
}

/** Live RGB waveform of the camera feed; channels add toward white where they agree. */
export function Waveform({ active }: { active: boolean }): React.JSX.Element {
    const target = useRef<Float32Array>(new Float32Array(COLUMNS * ROWS * 3))
    const shown = useRef<Float32Array>(new Float32Array(COLUMNS * ROWS * 3))
    const traceRef = useRef<HTMLCanvasElement | null>(null)
    useFrameSamples(active, sample => {
        target.current = measure(sample)
    })

    const canvasRef = useScopeCanvas((context, width, height, easing) => {
        easeToward(shown.current, target.current, easing)
        const plotHeight = height - PADDING_PX * 2

        context.strokeStyle = GRATICULE_COLOR
        context.lineWidth = 1
        for (let quarter = 0; quarter <= 4; quarter++) {
            const y = Math.round(PADDING_PX + (quarter / 4) * plotHeight) + 0.5
            context.beginPath()
            context.moveTo(0, y)
            context.lineTo(width, y)
            context.stroke()
        }

        const trace = (traceRef.current ??= document.createElement('canvas'))
        trace.width = COLUMNS
        trace.height = ROWS
        const traceContext = trace.getContext('2d')
        if (!traceContext) return
        const image = traceContext.createImageData(COLUMNS, ROWS)
        for (let cell = 0; cell < COLUMNS * ROWS; cell++) {
            const red = shown.current[cell * 3]
            const green = shown.current[cell * 3 + 1]
            const blue = shown.current[cell * 3 + 2]
            const strongest = Math.max(red, green, blue)
            image.data[cell * 4] = Math.round(255 * Math.min(1, red + (green + blue) * 0.12))
            image.data[cell * 4 + 1] = Math.round(255 * Math.min(1, green + (red + blue) * 0.12))
            image.data[cell * 4 + 2] = Math.round(255 * Math.min(1, blue + (red + green) * 0.18))
            image.data[cell * 4 + 3] = Math.round(255 * strongest)
        }
        traceContext.putImageData(image, 0, 0)
        context.imageSmoothingEnabled = true
        context.imageSmoothingQuality = 'high'
        // A slight soften turns the binned grid into a continuous, glowing trace.
        context.filter = 'blur(0.7px)'
        context.globalCompositeOperation = 'lighter'
        context.drawImage(trace, 0, PADDING_PX, width, plotHeight)
        context.globalCompositeOperation = 'source-over'
        context.filter = 'none'
    })

    return <canvas ref={canvasRef} className={`${SCOPE_CANVAS_CLASS} h-28`} role="img" aria-label="Live RGB waveform" />
}
