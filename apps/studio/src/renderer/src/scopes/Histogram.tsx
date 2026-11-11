import {
    easeToward,
    GRATICULE_COLOR,
    SCOPE_CANVAS_CLASS,
    useFrameSamples,
    useScopeCanvas,
    type FrameSample,
} from '@renderer/scopes/frame-sampling'
import { useRef } from 'react'

const BIN_COUNT = 96
/** Space above the tallest peak so curves never touch the top edge. */
const HEADROOM_PX = 10
/** Neighbouring bins averaged on each side, so the curve reads as a shape rather than noise. */
const SMOOTHING_RADIUS = 2

const CHANNELS = [
    { offset: 0, stroke: 'rgb(255 92 92)', fill: 'rgb(255 70 70 / 0.2)' },
    { offset: 1, stroke: 'rgb(84 214 120)', fill: 'rgb(60 200 100 / 0.2)' },
    { offset: 2, stroke: 'rgb(70 150 255)', fill: 'rgb(50 130 255 / 0.24)' },
] as const

function smooth(values: Float32Array): Float32Array {
    const result = new Float32Array(values.length)
    for (let index = 0; index < values.length; index++) {
        let sum = 0
        let count = 0
        for (let offset = -SMOOTHING_RADIUS; offset <= SMOOTHING_RADIUS; offset++) {
            const neighbour = index + offset
            if (neighbour < 0 || neighbour >= values.length) continue
            sum += values[neighbour]
            count++
        }
        result[index] = sum / count
    }
    return result
}

/**
 * Per-channel histograms laid end to end (R, G, B), smoothed and scaled 0–1. The square root keeps
 * a large flat area from flattening everything else, as camera histograms are usually drawn.
 */
function measure(sample: FrameSample | null): Float32Array {
    const result = new Float32Array(BIN_COUNT * 3)
    if (!sample) return result
    const counts = [new Float32Array(BIN_COUNT), new Float32Array(BIN_COUNT), new Float32Array(BIN_COUNT)]
    const { pixels } = sample
    for (let index = 0; index < pixels.length; index += 4) {
        for (const channel of CHANNELS) {
            counts[channel.offset][Math.min(BIN_COUNT - 1, (pixels[index + channel.offset] * BIN_COUNT) >> 8)]++
        }
    }
    const smoothed = counts.map(smooth)
    let peak = 0
    for (const bins of smoothed) for (const value of bins) peak = Math.max(peak, Math.sqrt(value))
    if (peak === 0) return result
    smoothed.forEach((bins, channel) => {
        for (let index = 0; index < BIN_COUNT; index++)
            result[channel * BIN_COUNT + index] = Math.sqrt(bins[index]) / peak
    })
    return result
}

/** A curve through the bins' midpoints, starting on the baseline. */
function tracePath(
    context: CanvasRenderingContext2D,
    bins: Float32Array,
    offset: number,
    width: number,
    height: number
): void {
    const x = (index: number): number => (index / (BIN_COUNT - 1)) * width
    const y = (index: number): number => height - bins[offset + index] * (height - HEADROOM_PX)
    context.beginPath()
    context.moveTo(0, height)
    context.lineTo(0, y(0))
    for (let index = 1; index < BIN_COUNT; index++) {
        context.quadraticCurveTo(
            x(index - 1),
            y(index - 1),
            (x(index - 1) + x(index)) / 2,
            (y(index - 1) + y(index)) / 2
        )
    }
    context.lineTo(width, y(BIN_COUNT - 1))
}

/** Live RGB histogram of the camera feed, eased between frames so it moves smoothly. */
export function Histogram({ frameUrl }: { frameUrl: string | null }): React.JSX.Element {
    const target = useRef<Float32Array>(new Float32Array(BIN_COUNT * 3))
    const shown = useRef<Float32Array>(new Float32Array(BIN_COUNT * 3))
    useFrameSamples(frameUrl, sample => {
        target.current = measure(sample)
    })

    const canvasRef = useScopeCanvas((context, width, height, easing) => {
        easeToward(shown.current, target.current, easing)
        context.strokeStyle = GRATICULE_COLOR
        context.lineWidth = 1
        for (let quarter = 1; quarter < 4; quarter++) {
            const x = Math.round((quarter / 4) * width) + 0.5
            context.beginPath()
            context.moveTo(x, 0)
            context.lineTo(x, height)
            context.stroke()
        }
        // Overlapping channels add up toward white, as on a camera's own histogram.
        context.globalCompositeOperation = 'lighter'
        for (const channel of CHANNELS) {
            tracePath(context, shown.current, channel.offset * BIN_COUNT, width, height)
            context.lineTo(width, height)
            context.closePath()
            context.fillStyle = channel.fill
            context.fill()
        }
        context.lineWidth = 1.5
        context.lineJoin = 'round'
        for (const channel of CHANNELS) {
            tracePath(context, shown.current, channel.offset * BIN_COUNT, width, height)
            context.strokeStyle = channel.stroke
            context.stroke()
        }
        context.globalCompositeOperation = 'source-over'
    })

    return (
        <canvas ref={canvasRef} className={`${SCOPE_CANVAS_CLASS} h-24`} role="img" aria-label="Live RGB histogram" />
    )
}
