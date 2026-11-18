import { useEffect, useRef } from 'react'

/**
 * The recording tally: a beam of light running round the picture's edge while recording. A conic mask turns round
 * the frame and uncovers three layers: a 2px stroke on the edge (a white streak over red), a soft red glow just
 * inside it, and a blurred white bloom along the stroke. The red is fourteen soft patches round the edge in shades of
 * the recording red, each drifting, stretching and deepening on its own slow cycle, so the glow is uneven and never
 * the same twice. The beam's speed swells and eases three times a lap.
 */

const RADIUS = 6
const STROKE = 2
/** Seconds a lap takes at the average speed, and how far the speed swings: fastest / slowest = (1 + A) / (1 - A). */
const LAP_SECONDS = 4
const SWELLS_PER_LAP = 3
const SWING = 0.33
/** How far the glow reaches in, as a multiple of each patch's depth. */
const DEPTH = 0.7
const FADE_IN_SECONDS = 0.6
/** The red sways a few degrees of hue either way over this many seconds. */
const HUE_SWAY = 5
const HUE_SECONDS = 12

/** The recording red (`--color-rec`) and shades of it: deeper, brighter or warmer, never yellow or pink. */
const RED: [number, number, number] = [232, 52, 64]
const SHADES: [number, number, number][] = [
    [1, 1, 1],
    [1.05, 1.45, 0.8],
    [0.82, 0.6, 0.7],
    [1.08, 1.75, 0.7],
    [0.92, 0.75, 0.85],
    [1, 1.25, 0.85],
    [1.08, 1.6, 0.6],
    [0.72, 0.5, 0.6],
    [1, 0.85, 0.9],
]

/** Each patch sits on one edge at `at`%, covers `length` of that edge and reaches `depth` px in. */
type Edge = 'top' | 'right' | 'bottom' | 'left'
const PATCHES: Array<[Edge, number, number, number]> = [
    ['top', 8, 0.45, 40],
    ['top', 38, 0.35, 60],
    ['top', 64, 0.5, 35],
    ['top', 91, 0.3, 55],
    ['right', 16, 0.4, 50],
    ['right', 50, 0.45, 38],
    ['right', 84, 0.35, 58],
    ['bottom', 86, 0.4, 42],
    ['bottom', 56, 0.5, 60],
    ['bottom', 26, 0.35, 45],
    ['bottom', 5, 0.3, 52],
    ['left', 80, 0.45, 50],
    ['left', 46, 0.4, 36],
    ['left', 13, 0.35, 56],
]

/** Four slow drifts, 0 to 1 and back, on periods that never line up: [seconds one way, head start]. */
const DRIFTS: Array<[number, number]> = [
    [3.1, 0.4],
    [4.7, 2.9],
    [3.9, 1.3],
    [5.9, 4.2],
]

/** The patches as radial gradients: each one's depth, length and place along its edge ride a drift. */
function patches(alpha: number, scale: number): string {
    const drift = (index: number): string => `var(--drift-${index % DRIFTS.length})`
    return PATCHES.map(([edge, at, length, depth], index) => {
        const [r, g, b] = RED.map((value, channel) =>
            Math.min(255, Math.round(value * SHADES[index % SHADES.length][channel]))
        )
        const across = edge === 'top' || edge === 'bottom'
        const along = `calc(var(--${across ? 'width' : 'height'}) * ${(length / 2) * scale} * (0.7 + 0.6 * ${drift(index + 1)}))`
        const inward = `calc(${depth * scale * DEPTH}px * (0.5 + ${drift(index)}))`
        const place = `calc(${at}% + 24% * (${drift(index + 2)} - 0.5))`
        const position = { top: `${place} 0%`, bottom: `${place} 100%`, left: `0% ${place}`, right: `100% ${place}` }[
            edge
        ]
        return `radial-gradient(ellipse ${across ? `${along} ${inward}` : `${inward} ${along}`} at ${position}, rgba(${r}, ${g}, ${b}, ${alpha}), transparent)`
    }).join(',')
}

/** What the beam uncovers: the turning conic mask, from its tail (30%) through full light (52–80%) to its head. */
const SWEEP = `conic-gradient(from var(--angle), transparent 30%, rgb(255 255 255 / 10%) 36%, rgb(255 255 255 / 35%) 44%, white 52%, white 80%, rgb(255 255 255 / 35%) 86%, rgb(255 255 255 / 10%) 92%, transparent 95%)`
const WHITE_STREAK = `conic-gradient(from var(--angle), transparent 54%, rgb(255 255 255 / 10%) 57%, rgb(255 255 255 / 30%) 60%, rgb(255 255 255 / 60%) 63%, rgb(255 255 255 / 75%) 66%, rgb(255 255 255 / 60%) 69%, rgb(255 255 255 / 30%) 72%, rgb(255 255 255 / 10%) 75%, transparent 78%)`
const BLOOM = `conic-gradient(from var(--angle), transparent 58%, rgb(255 255 255 / 3%) 62%, rgb(255 255 255 / 8%) 65%, rgb(255 255 255 / 20%) 67%, rgb(255 255 255 / 45%) 69%, rgb(255 255 255 / 85%) 70%, rgb(255 255 255 / 85%) 70.5%, rgb(255 255 255 / 45%) 71.5%, rgb(255 255 255 / 20%) 73%, rgb(255 255 255 / 8%) 75%, rgb(255 255 255 / 3%) 78%, transparent 82%)`
const RING = 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)'
const LIGHT = 'hue-rotate(var(--hue)) brightness(1.25) saturate(1.2)'

const CSS = `
.recording-tally {
    border-radius: ${RADIUS}px; overflow: hidden;
    --width: 960px; --height: 640px; --angle: 0deg; --hue: 0deg; --fade: 0;
    --drift-0: 0.5; --drift-1: 0.5; --drift-2: 0.5; --drift-3: 0.5;
}
.recording-tally::after, .recording-tally::before, .recording-tally > div {
    content: ''; position: absolute; inset: 0; border-radius: ${RADIUS}px; clip-path: inset(0 round ${RADIUS}px); pointer-events: none;
}
.recording-tally::after {
    z-index: 2; padding: ${STROKE}px; background: ${WHITE_STREAK}, ${patches(1, 1)};
    mask: ${SWEEP}, ${RING}; mask-composite: intersect, exclude;
    opacity: calc(var(--fade) * 0.85); filter: ${LIGHT};
}
.recording-tally::before {
    z-index: 1; background: ${patches(0.45, 0.9)};
    mask: ${SWEEP}; opacity: calc(var(--fade) * 0.6); filter: ${LIGHT};
}
.recording-tally > div {
    z-index: 3; padding: ${STROKE}px; background: ${BLOOM};
    mask: ${RING}; mask-composite: exclude;
    opacity: calc(var(--fade) * 0.5); filter: blur(8px) brightness(1.25) saturate(1.2);
}
`

export function RecordingTally({ style }: { style?: React.CSSProperties }): React.JSX.Element {
    const ref = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const element = ref.current
        if (!element) return
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const resize = new ResizeObserver(([entry]) => {
            element.style.setProperty('--width', `${Math.round(entry.contentRect.width)}px`)
            element.style.setProperty('--height', `${Math.round(entry.contentRect.height)}px`)
        })
        resize.observe(element)
        const start = performance.now()
        let frame = 0
        const draw = (now: number): void => {
            frame = requestAnimationFrame(draw)
            const seconds = (now - start) / 1000
            const t = still ? 0 : seconds
            // angle = 360 * (p + A sin(2πnp) / 2πn): its speed is 1 + A cos(2πnp), swelling n times a lap.
            const lap = t / LAP_SECONDS
            const swell = 2 * Math.PI * SWELLS_PER_LAP
            element.style.setProperty('--angle', `${360 * (lap + (SWING * Math.sin(swell * lap)) / swell)}deg`)
            DRIFTS.forEach(([period, head], index) =>
                element.style.setProperty(
                    `--drift-${index}`,
                    String(0.5 - 0.5 * Math.cos((Math.PI * (t + head)) / period))
                )
            )
            element.style.setProperty('--hue', `${-HUE_SWAY * Math.cos((2 * Math.PI * t) / HUE_SECONDS)}deg`)
            element.style.setProperty('--fade', String(Math.min(1, seconds / FADE_IN_SECONDS)))
        }
        frame = requestAnimationFrame(draw)
        return () => {
            cancelAnimationFrame(frame)
            resize.disconnect()
        }
    }, [])

    return (
        <div
            ref={ref}
            className="recording-tally"
            style={{ position: 'absolute', inset: 0, isolation: 'isolate', ...style }}
            aria-hidden
        >
            <style>{CSS}</style>
            <div />
        </div>
    )
}
