import { useEffect, useRef } from 'react'

/**
 * Darkgrade brand background — Perlin noise + marching squares, ported from
 * packages/ui/src/bg/perlin-noise-simulation.tsx via the Claude v14 landing
 * page. Capped at ~30fps, DPR-capped, paused when hidden.
 */

const RESOLUTION = 12
const THRESHOLD_INCREMENT = 5
const THICK_MULTIPLE = 3
const Z_RATE = 0.000015
const MIN_FRAME_MS = 33
const THICK_COLOR = '#ffffff'
const THIN_COLOR = '#808080'
const BG_COLOR = '#000000'
const THICK_WIDTH = 1.5
const THIN_WIDTH = 1

function createNoise(): (x: number, y: number, z: number) => number {
    const perm = (() => {
        const p = new Uint8Array(512)
        const s = new Uint8Array(256)
        for (let i = 0; i < 256; i++) s[i] = i
        for (let i = 255; i > 0; i--) {
            const j = (Math.random() * (i + 1)) | 0
            const t = s[i]
            s[i] = s[j]
            s[j] = t
        }
        for (let i = 0; i < 512; i++) p[i] = s[i & 255]
        return p
    })()

    const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10)
    const lerp = (a: number, b: number, t: number): number => a + t * (b - a)
    const grad = (h: number, x: number, y: number, z: number): number => {
        h &= 15
        const u = h < 8 ? x : y
        const v = h < 4 ? y : h === 12 || h === 14 ? x : z
        return ((h & 1) !== 0 ? -u : u) + ((h & 2) !== 0 ? -v : v)
    }

    return (x, y, z) => {
        const X = Math.floor(x) & 255
        const Y = Math.floor(y) & 255
        const Z = Math.floor(z) & 255
        x -= Math.floor(x)
        y -= Math.floor(y)
        z -= Math.floor(z)
        const u = fade(x)
        const v = fade(y)
        const w = fade(z)
        const A = perm[X] + Y
        const AA = perm[A] + Z
        const AB = perm[A + 1] + Z
        const B = perm[X + 1] + Y
        const BA = perm[B] + Z
        const BB = perm[B + 1] + Z
        const n = lerp(
            lerp(
                lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
                lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u),
                v
            ),
            lerp(
                lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
                lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u),
                v
            ),
            w
        )
        return (n + 1) / 2
    }
}

export function BrandBackground(): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const noise = createNoise()
        let cols = 0
        let rows = 0
        let logicalWidth = 0
        let logicalHeight = 0
        let z = 0
        let threshold = 0
        let lastTime = -1
        let rafId = 0
        const grid: number[][] = []

        const setup = (): void => {
            const dpr = Math.min(window.devicePixelRatio || 1, 2)
            logicalWidth = window.innerWidth
            logicalHeight = window.innerHeight
            canvas.width = logicalWidth * dpr
            canvas.height = logicalHeight * dpr
            canvas.style.width = `${logicalWidth}px`
            canvas.style.height = `${logicalHeight}px`
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            ctx.imageSmoothingEnabled = true
            ctx.lineCap = 'round'
            ctx.lineJoin = 'round'
            cols = Math.floor(logicalWidth / RESOLUTION) + 1
            rows = Math.floor(logicalHeight / RESOLUTION) + 1
        }

        const interp = (a: number, b: number): number => (a === b ? 0 : (threshold - a) / (b - a))

        const generate = (): [number, number] => {
            let min = 100
            let max = 0
            for (let y = 0; y < rows; y++) {
                const row = grid[y] ?? (grid[y] = [])
                for (let x = 0; x <= cols; x++) {
                    const value = noise(x * 0.02, y * 0.02, z) * 100
                    row[x] = value
                    if (value < min) min = value
                    if (value > max) max = value
                }
            }
            return [min, max]
        }

        const placeLines = (g: number, x: number, y: number): void => {
            const nw = grid[y][x]
            const ne = grid[y][x + 1]
            const se = grid[y + 1][x + 1]
            const sw = grid[y + 1][x]
            const px = x * RESOLUTION
            const py = y * RESOLUTION
            let a: [number, number], b: [number, number], c: [number, number], d: [number, number]
            switch (g) {
                case 1:
                case 14:
                    c = [px + RESOLUTION * interp(sw, se), py + RESOLUTION]
                    d = [px, py + RESOLUTION * interp(nw, sw)]
                    ctx.moveTo(d[0], d[1])
                    ctx.lineTo(c[0], c[1])
                    break
                case 2:
                case 13:
                    b = [px + RESOLUTION, py + RESOLUTION * interp(ne, se)]
                    c = [px + RESOLUTION * interp(sw, se), py + RESOLUTION]
                    ctx.moveTo(b[0], b[1])
                    ctx.lineTo(c[0], c[1])
                    break
                case 3:
                case 12:
                    b = [px + RESOLUTION, py + RESOLUTION * interp(ne, se)]
                    d = [px, py + RESOLUTION * interp(nw, sw)]
                    ctx.moveTo(d[0], d[1])
                    ctx.lineTo(b[0], b[1])
                    break
                case 11:
                case 4:
                    a = [px + RESOLUTION * interp(nw, ne), py]
                    b = [px + RESOLUTION, py + RESOLUTION * interp(ne, se)]
                    ctx.moveTo(a[0], a[1])
                    ctx.lineTo(b[0], b[1])
                    break
                case 5:
                    a = [px + RESOLUTION * interp(nw, ne), py]
                    b = [px + RESOLUTION, py + RESOLUTION * interp(ne, se)]
                    c = [px + RESOLUTION * interp(sw, se), py + RESOLUTION]
                    d = [px, py + RESOLUTION * interp(nw, sw)]
                    ctx.moveTo(d[0], d[1])
                    ctx.lineTo(a[0], a[1])
                    ctx.moveTo(c[0], c[1])
                    ctx.lineTo(b[0], b[1])
                    break
                case 6:
                case 9:
                    a = [px + RESOLUTION * interp(nw, ne), py]
                    c = [px + RESOLUTION * interp(sw, se), py + RESOLUTION]
                    ctx.moveTo(c[0], c[1])
                    ctx.lineTo(a[0], a[1])
                    break
                case 7:
                case 8:
                    a = [px + RESOLUTION * interp(nw, ne), py]
                    d = [px, py + RESOLUTION * interp(nw, sw)]
                    ctx.moveTo(d[0], d[1])
                    ctx.lineTo(a[0], a[1])
                    break
                case 10:
                    a = [px + RESOLUTION * interp(nw, ne), py]
                    b = [px + RESOLUTION, py + RESOLUTION * interp(ne, se)]
                    c = [px + RESOLUTION * interp(sw, se), py + RESOLUTION]
                    d = [px, py + RESOLUTION * interp(nw, sw)]
                    ctx.moveTo(a[0], a[1])
                    ctx.lineTo(b[0], b[1])
                    ctx.moveTo(c[0], c[1])
                    ctx.lineTo(d[0], d[1])
                    break
            }
        }

        const renderThreshold = (): void => {
            ctx.beginPath()
            const isThick = threshold % (THRESHOLD_INCREMENT * THICK_MULTIPLE) === 0
            ctx.strokeStyle = isThick ? THICK_COLOR : THIN_COLOR
            ctx.lineWidth = isThick ? THICK_WIDTH : THIN_WIDTH
            for (let y = 0; y < rows - 1; y++) {
                const gy = grid[y]
                const gy1 = grid[y + 1]
                for (let x = 0; x < cols; x++) {
                    const a = gy[x] > threshold
                    const b = gy[x + 1] > threshold
                    const c = gy1[x + 1] > threshold
                    const d = gy1[x] > threshold
                    if (a && b && c && d) continue
                    if (!a && !b && !c && !d) continue
                    const g = ((a ? 1 : 0) << 3) | ((b ? 1 : 0) << 2) | ((c ? 1 : 0) << 1) | (d ? 1 : 0)
                    placeLines(g, x, y)
                }
            }
            ctx.stroke()
        }

        const draw = (): void => {
            ctx.fillStyle = BG_COLOR
            ctx.fillRect(0, 0, logicalWidth, logicalHeight)
            const [min, max] = generate()
            const lo = Math.floor(min / THRESHOLD_INCREMENT) * THRESHOLD_INCREMENT
            const hi = Math.ceil(max / THRESHOLD_INCREMENT) * THRESHOLD_INCREMENT
            for (threshold = lo; threshold < hi; threshold += THRESHOLD_INCREMENT) renderThreshold()
        }

        const frame = (now: number): void => {
            rafId = requestAnimationFrame(frame)
            if (document.hidden) {
                lastTime = now
                return
            }
            if (lastTime < 0) {
                lastTime = now
                return
            }
            const dt = now - lastTime
            if (dt < MIN_FRAME_MS) return
            lastTime = now
            z += Z_RATE * dt
            draw()
        }

        setup()
        window.addEventListener('resize', setup)
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        if (reduceMotion) {
            z = 40
            draw()
        } else {
            rafId = requestAnimationFrame(frame)
        }

        return () => {
            cancelAnimationFrame(rafId)
            window.removeEventListener('resize', setup)
        }
    }, [])

    return <canvas className="brand-background" ref={canvasRef} aria-hidden="true" />
}
