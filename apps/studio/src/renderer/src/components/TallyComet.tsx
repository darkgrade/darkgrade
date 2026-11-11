import { useEffect, useRef } from 'react'

/** Seconds for the comet to go once around the frame. */
const ORBIT_SECONDS = 16
/** Tail length as a share of the frame's perimeter. */
const TAIL_SHARE = 0.18
/** Points sampled along the tail; enough that it bends smoothly through corners. */
const TAIL_SAMPLES = 80
/** Room around the frame for the glow, in CSS pixels. */
const GLOW_MARGIN = 48
/**
 * The tube is the tally's 2px border. This canvas is placed from inside that border, so the tube's centre line
 * sits 1px outside the canvas's inner rectangle; its radius is the border's 10px less half its width.
 */
const TUBE_BORDER_WIDTH = 2
const TUBE_RADIUS = 9
/** Stacked strokes that build the tail, each a continuous line to the head, so there are no seams. */
const TAIL_PASSES = 24
/** The head is a perfect circle: its white core and its red glow, in CSS pixels. */
const HEAD_RADIUS = 1.8
const HEAD_GLOW_RADIUS = 5

interface Point {
    x: number
    y: number
}

/** A point at distance along a rounded rectangle's outline, clockwise from the top edge's left end. */
function pointOnOutline(width: number, height: number, radius: number, distance: number): Point {
    const straightTop = width - 2 * radius
    const straightSide = height - 2 * radius
    const arc = (Math.PI / 2) * radius
    const segments: Array<[number, (along: number) => Point]> = [
        [straightTop, along => ({ x: radius + along, y: 0 })],
        [arc, along => corner(width - radius, radius, -Math.PI / 2 + along / radius)],
        [straightSide, along => ({ x: width, y: radius + along })],
        [arc, along => corner(width - radius, height - radius, along / radius)],
        [straightTop, along => ({ x: width - radius - along, y: height })],
        [arc, along => corner(radius, height - radius, Math.PI / 2 + along / radius)],
        [straightSide, along => ({ x: 0, y: height - radius - along })],
        [arc, along => corner(radius, radius, Math.PI + along / radius)],
    ]
    const perimeter = segments.reduce((sum, [length]) => sum + length, 0)
    let remaining = ((distance % perimeter) + perimeter) % perimeter
    for (const [length, at] of segments) {
        if (remaining <= length) return at(remaining)
        remaining -= length
    }
    return { x: radius, y: 0 }

    function corner(centerX: number, centerY: number, angle: number): Point {
        return { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) }
    }
}

function outlinePerimeter(width: number, height: number, radius: number): number {
    return 2 * (width - 2 * radius) + 2 * (height - 2 * radius) + 2 * Math.PI * radius
}

/**
 * A comet that travels around the recording tally's tube: drawn each frame along the tube's own outline, so its
 * tail bends through the corners with it. The tail tapers and fades from the recording red to a white-hot head.
 */
export function TallyComet(): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return
        const red = getComputedStyle(canvas).getPropertyValue('--color-rec').trim() || 'oklch(0.64 0.23 25)'
        let frame = 0
        const startedAtMs = performance.now()

        const draw = (nowMs: number): void => {
            frame = requestAnimationFrame(draw)
            const pixelRatio = window.devicePixelRatio || 1
            const bounds = canvas.getBoundingClientRect()
            const pixelWidth = Math.round(bounds.width * pixelRatio)
            const pixelHeight = Math.round(bounds.height * pixelRatio)
            if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
                canvas.width = pixelWidth
                canvas.height = pixelHeight
            }
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
            context.clearRect(0, 0, bounds.width, bounds.height)

            const width = bounds.width - 2 * GLOW_MARGIN + TUBE_BORDER_WIDTH
            const height = bounds.height - 2 * GLOW_MARGIN + TUBE_BORDER_WIDTH
            if (width <= 0 || height <= 0) return
            const perimeter = outlinePerimeter(width, height, TUBE_RADIUS)
            const head = (((nowMs - startedAtMs) / 1000 / ORBIT_SECONDS) % 1) * perimeter
            const tailLength = perimeter * TAIL_SHARE
            const origin = GLOW_MARGIN - TUBE_BORDER_WIDTH / 2
            const points = Array.from({ length: TAIL_SAMPLES + 1 }, (_, index) => {
                const point = pointOnOutline(width, height, TUBE_RADIUS, head - tailLength * (1 - index / TAIL_SAMPLES))
                return { x: point.x + origin, y: point.y + origin }
            })

            context.globalCompositeOperation = 'lighter'
            context.lineCap = 'butt'
            context.lineJoin = 'round'
            const front = points.slice(Math.floor(points.length * 0.45))
            // Haze: a wide, soft cloud of light around the front half, as in a long-exposure streak.
            context.filter = 'blur(16px)'
            strokeTail(context, front, red, 26, 0.3)
            context.filter = 'blur(6px)'
            strokeTail(context, front, red, 9, 0.28)
            // Core: a long thin line, dim red at the tail, brightening and whitening toward the head.
            context.filter = 'blur(0.6px)'
            strokeTail(context, points, red, 2, 0.75)
            context.filter = 'none'
            drawHead(context, points, red)
        }
        frame = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(frame)
    }, [])

    return (
        <canvas
            ref={canvasRef}
            className="tally-comet pointer-events-none absolute"
            style={{
                inset: -GLOW_MARGIN,
                width: `calc(100% + ${2 * GLOW_MARGIN}px)`,
                height: `calc(100% + ${2 * GLOW_MARGIN}px)`,
            }}
            aria-hidden
        />
    )
}

/**
 * Draws the tail as stacked continuous strokes, each starting further forward and ending at the head: brightness
 * and width build smoothly toward the head with no seams between pieces.
 */
function strokeTail(
    context: CanvasRenderingContext2D,
    points: Point[],
    red: string,
    maximumWidth: number,
    maximumOpacity: number,
    whitenTowardHead = false
): void {
    const last = points.length - 1
    for (let pass = 0; pass < TAIL_PASSES; pass++) {
        const progress = pass / (TAIL_PASSES - 1)
        const start = Math.floor(progress * (last - 1))
        context.globalAlpha = (maximumOpacity / TAIL_PASSES) * 2.2
        context.lineWidth = Math.max(0.5, maximumWidth * (0.35 + 0.65 * progress))
        context.strokeStyle =
            whitenTowardHead && progress > 0.96
                ? `color-mix(in oklab, white ${Math.round((progress - 0.96) * 1500)}%, ${red})`
                : red
        context.beginPath()
        context.moveTo(points[start].x, points[start].y)
        for (let index = start + 1; index <= last; index++) context.lineTo(points[index].x, points[index].y)
        context.stroke()
    }
    context.globalAlpha = 1
}

/** The head: a white circle with a round red glow, centred on the tube at the comet's front. */
function drawHead(context: CanvasRenderingContext2D, points: Point[], red: string): void {
    const head = points[points.length - 1]
    context.filter = 'blur(4px)'
    context.globalAlpha = 0.45
    context.fillStyle = red
    context.beginPath()
    context.arc(head.x, head.y, HEAD_GLOW_RADIUS, 0, Math.PI * 2)
    context.fill()
    context.filter = 'blur(0.5px)'
    context.globalAlpha = 1
    context.fillStyle = '#fff'
    context.beginPath()
    context.arc(head.x, head.y, HEAD_RADIUS, 0, Math.PI * 2)
    context.fill()
    context.filter = 'none'
}
