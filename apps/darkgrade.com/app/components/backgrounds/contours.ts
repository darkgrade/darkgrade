import { noise, noiseSeed } from '@chriscourses/perlin-noise'
import { CONTOUR_RES, CONTOUR_Z_RATE, NOISE_SEED } from './field'

/**
 * The original background: a topographic map of 3D Perlin noise, drawn as
 * marching-squares contour lines on a 2D canvas. Ported from
 * packages/ui/src/bg/perlin-noise-simulation.tsx so it can share this page's
 * clock and pointer with the silk shader; base simulation mechanics from
 * https://codepen.io/josev1207/pen/ZEdEmgQ
 *
 * Four things changed in the port:
 *  - z comes from the shared clock instead of accumulating per frame, so the
 *    layer can be parked while faded out and resume in phase
 *  - the grid is sized in CSS px. The original divided the DEVICE-pixel canvas
 *    width by res but drew at logical coordinates, so on a 2x display it built
 *    (and marched) four times the cells it could show
 *  - values live in one flat Float32Array instead of ragged arrays rebuilt
 *    every frame
 *  - the canvas is cleared rather than filled black, so it can cross-fade over
 *    the silk instead of occluding it
 */
noiseSeed(NOISE_SEED)

const THRESHOLD_STEP = 5
const THICK_EVERY = 3
const THICK_COLOR = '#ffffff'
const THIN_COLOR = '#808080'
const THICK_WIDTH = 1.5
const THIN_WIDTH = 1

export type ContourRenderer = {
    resize(): void
    /** pointer in CSS px, relative to the canvas. */
    draw(t: number, pointerX: number, pointerY: number): void
    destroy(): void
}

export function createContours(canvas: HTMLCanvasElement): ContourRenderer | null {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const res = CONTOUR_RES
    let w = 0
    let h = 0
    let cols = 0
    let rows = 0
    let stride = 0
    let values = new Float32Array(0)
    let boost = new Float32Array(0)
    let threshold = 0

    const resize = () => {
        w = canvas.clientWidth || innerWidth
        h = canvas.clientHeight || innerHeight
        if (w <= 0 || h <= 0) return
        const dpr = Math.min(devicePixelRatio || 1, 2)
        canvas.width = Math.floor(w * dpr)
        canvas.height = Math.floor(h * dpr)
        // setTransform, not scale: scale() compounds every time we re-measure
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.imageSmoothingEnabled = true
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        cols = Math.floor(w / res) + 1
        rows = Math.floor(h / res) + 1
        stride = cols + 1
        values = new Float32Array(stride * rows)
        boost = new Float32Array(stride * rows)
    }
    resize()

    /** the pointer pushes the noise field forward in z, softly, within a radius */
    const pushField = (px: number, py: number) => {
        const cx = Math.floor(px / res)
        const cy = Math.floor(py / res)
        if (cx < 0 || cy < 0 || cx >= stride || cy >= rows) return
        const radius = 5
        const r2 = radius * radius
        const step = 0.0025
        for (let i = -radius; i <= radius; i++) {
            const y = cy + i
            if (y < 0 || y >= rows) continue
            for (let j = -radius; j <= radius; j++) {
                const x = cx + j
                if (x < 0 || x >= stride) continue
                const d2 = i * i + j * j
                if (d2 > r2) continue
                boost[y * stride + x] += step * (1 - d2 / r2)
            }
        }
    }

    const sample = (z: number) => {
        let min = Infinity
        let max = -Infinity
        for (let y = 0; y < rows; y++) {
            const row = y * stride
            for (let x = 0; x < stride; x++) {
                const i = row + x
                const v = noise(x * 0.02, y * 0.02, z + boost[i]!) * 100
                values[i] = v
                if (v < min) min = v
                if (v > max) max = v
                if (boost[i]! > 0) boost[i]! *= 0.99
            }
        }
        return { min, max }
    }

    const lerpEdge = (a: number, b: number) => (a === b ? 0 : (threshold - a) / (b - a))

    const marchCell = (kind: number, x: number, y: number) => {
        const i = y * stride + x
        const nw = values[i]!
        const ne = values[i + 1]!
        const sw = values[i + stride]!
        const se = values[i + stride + 1]!
        const x0 = x * res
        const y0 = y * res
        const x1 = x0 + res
        const y1 = y0 + res

        // the four edge crossings, named for the side they sit on
        const top = () => [x0 + res * lerpEdge(nw, ne), y0] as const
        const right = () => [x1, y0 + res * lerpEdge(ne, se)] as const
        const bottom = () => [x0 + res * lerpEdge(sw, se), y1] as const
        const left = () => [x0, y0 + res * lerpEdge(nw, sw)] as const
        const seg = (a: readonly [number, number], b: readonly [number, number]) => {
            ctx.moveTo(a[0], a[1])
            ctx.lineTo(b[0], b[1])
        }

        switch (kind) {
            case 1:
            case 14:
                seg(left(), bottom())
                break
            case 2:
            case 13:
                seg(right(), bottom())
                break
            case 3:
            case 12:
                seg(left(), right())
                break
            case 4:
            case 11:
                seg(top(), right())
                break
            case 5:
                seg(left(), top())
                seg(bottom(), right())
                break
            case 6:
            case 9:
                seg(bottom(), top())
                break
            case 7:
            case 8:
                seg(left(), top())
                break
            case 10:
                seg(top(), right())
                seg(bottom(), left())
                break
            default:
                break
        }
    }

    const strokeThreshold = () => {
        ctx.beginPath()
        const thick = threshold % (THRESHOLD_STEP * THICK_EVERY) === 0
        ctx.strokeStyle = thick ? THICK_COLOR : THIN_COLOR
        ctx.lineWidth = thick ? THICK_WIDTH : THIN_WIDTH

        for (let y = 0; y < rows - 1; y++) {
            const row = y * stride
            for (let x = 0; x < stride - 1; x++) {
                const i = row + x
                const nw = values[i]! > threshold
                const ne = values[i + 1]! > threshold
                const se = values[i + stride + 1]! > threshold
                const sw = values[i + stride]! > threshold
                // wholly above or wholly below: no contour crosses this cell
                if (nw === ne && ne === se && se === sw) continue
                marchCell(((nw ? 8 : 0) | (ne ? 4 : 0) | (se ? 2 : 0) | (sw ? 1 : 0)) >>> 0, x, y)
            }
        }
        ctx.stroke()
    }

    return {
        resize,
        draw(t, pointerX, pointerY) {
            if (!values.length) return
            ctx.clearRect(0, 0, w, h)
            pushField(pointerX, pointerY)
            const { min, max } = sample(t * CONTOUR_Z_RATE)
            if (!Number.isFinite(min) || !Number.isFinite(max)) return
            const from = Math.floor(min / THRESHOLD_STEP) * THRESHOLD_STEP
            const to = Math.ceil(max / THRESHOLD_STEP) * THRESHOLD_STEP
            for (threshold = from; threshold < to; threshold += THRESHOLD_STEP) strokeThreshold()
        },
        destroy() {
            values = new Float32Array(0)
            boost = new Float32Array(0)
        },
    }
}
