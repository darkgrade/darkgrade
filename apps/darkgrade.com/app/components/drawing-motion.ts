/*
 * Motion for the isometric product drawings. Each motion takes the injected <svg>
 * and returns a function that poses it at a progress from 0 to 1; locomotive's
 * scroll progress drives it, the same as the text reveals.
 * The numbers are the drawings' own geometry, carried over with the artwork.
 */

export type Pose = (progress: number) => void
export type MotionName = 'aperture' | 'record' | 'studio'

const smoothstep = (value: number) => {
    const clamped = Math.min(1, Math.max(0, value))
    return clamped * clamped * (3 - 2 * clamped)
}

/* Link: the aperture stops down from f/2.8 to f/16 while the lens lifts off the body */
const F_STOPS = [2.8, 16]
const LENS_LIFT = [0, -72]
const IRIS_RADIUS = 22

function bladePaths(openingRadius: number) {
    const point = (angle: number, radius: number) =>
        `${(Math.cos(angle) * radius).toFixed(3)} ${(Math.sin(angle) * radius).toFixed(3)}`
    return Array.from({ length: 8 }, (_, index) => {
        const start = (index * Math.PI) / 4
        const end = start + Math.PI / 4
        return (
            `M${point(start, openingRadius)}L${point(end, openingRadius)}` +
            `Q${point(end + 0.55, IRIS_RADIUS + 2)} ${point(end + 0.6, IRIS_RADIUS)}` +
            `A${IRIS_RADIUS} ${IRIS_RADIUS} 0 0 0 ${point(start + 0.6, IRIS_RADIUS)}` +
            `Q${point(start + 0.3, IRIS_RADIUS + 2)} ${point(start, openingRadius)}Z`
        )
    })
}

function aperture(svg: SVGSVGElement): Pose {
    const blades = [...svg.querySelectorAll<SVGPathElement>('.aperture-blade')]
    const lens = svg.querySelector('.camera-lens')
    return progress => {
        const fStop = F_STOPS[0] * (F_STOPS[1] / F_STOPS[0]) ** progress
        bladePaths((20 * F_STOPS[0]) / fStop).forEach((path, index) => blades[index]?.setAttribute('d', path))
        const lift = smoothstep((progress - 0.15) / 0.75)
        lens?.setAttribute('transform', `translate(${LENS_LIFT[0] * lift} ${LENS_LIFT[1] * lift})`)
    }
}

/* Matrix: one camera record rises out of the card index and comes to the front */
const RECORD_PIECES = ['record.guide.-60', 'record.6', 'record.6.tab', 'record.guide.58']
const RECORD_RISE = -30.255
const RECORD_LIFT = 11.658
/** Painting depth of each card-index piece, in document order: higher paints later. */
const INDEX_DEPTHS = [
    -91, -89.145, -29.715, -27.86, 14.877, 16.732, 76.162, 78.017, 78.037, 78.057, 78.057, 78.057, 78.057, 78.077,
    78.077, 78.077, 78.077, 78.077, 78.077, 78.077, 78.077, 78.077, 78.097, 78.097, 78.097, 78.097, 78.117, 78.117,
    78.117, 78.117, 78.137, 78.137, 78.137, 78.157, 78.157, 78.157, 78.157, 78.157, 78.177, 78.197, 78.197, 78.217,
    78.237, 78.237, 78.257, 78.277, 78.277, 78.297, 78.317, 78.317, 78.337, 78.357, 78.357, 78.357, 78.377, 90.035,
    90.055, 90.055, 90.075, 90.075, 90.095, 91.656, 96.915,
]

function record(svg: SVGSVGElement): Pose {
    const pieces = [...svg.querySelectorAll<SVGGElement>('[data-piece]')].map((element, index) => ({
        element,
        depth: INDEX_DEPTHS[index] ?? 0,
        rises: RECORD_PIECES.includes(element.dataset.piece ?? ''),
    }))
    const layer = pieces[0]?.element.parentNode
    let paintOrder = ''
    return progress => {
        for (const piece of pieces.filter(piece => piece.rises)) {
            piece.element.setAttribute('transform', `translate(0 ${RECORD_RISE * progress})`)
        }
        const sorted = [...pieces].sort(
            (first, second) =>
                first.depth +
                (first.rises ? RECORD_LIFT * progress : 0) -
                (second.depth + (second.rises ? RECORD_LIFT * progress : 0))
        )
        const order = sorted.map(piece => pieces.indexOf(piece)).join(',')
        if (order === paintOrder) return
        paintOrder = order
        layer?.append(...sorted.map(piece => piece.element))
    }
}

/* Studio: the whole set turns a few degrees while the camera and its dolly track forward */
const PROJECTION = { scale: 1.4921704352150595, azimuthDegrees: 40, elevationDegrees: 28 }
const SET_TURN_DEGREES = -3.2
const DOLLY_TRAVEL = 34
const CAMERA: [number, number] = [-16, 99]
const ANCHORS: Record<string, [number, number]> = {
    backdrop: [0, -119],
    subject: [0, -52],
    camera: CAMERA,
    rails: CAMERA,
    dolly: CAMERA,
    key: [-111, -29],
    fill: [108, -22],
    rim: [-136, -90],
    boom: [128, -87],
    monitor: [-126, 105],
    flag: [106, 155],
    cases: [-146, 31],
}
const TRACKING = new Set(['camera', 'dolly'])

/** Projects a floor-plane offset (x, y, with z = 0) into the drawing's isometric screen space. */
function projectOffset(x: number, y: number) {
    const azimuth = (PROJECTION.azimuthDegrees * Math.PI) / 180
    const elevation = (PROJECTION.elevationDegrees * Math.PI) / 180
    const unit = PROJECTION.scale * Math.sqrt(1.6)
    return [
        (x * Math.sin(azimuth) - y * Math.cos(azimuth)) * unit,
        (x * Math.cos(azimuth) + y * Math.sin(azimuth)) * Math.sin(elevation) * unit,
    ]
}

function studio(svg: SVGSVGElement): Pose {
    const parts = [...svg.querySelectorAll<SVGGElement>('[data-assembly]')]
    return progress => {
        const eased = smoothstep(progress)
        const turn = (SET_TURN_DEGREES * eased * Math.PI) / 180
        for (const part of parts) {
            const assembly = part.dataset.assembly ?? ''
            const [anchorX, anchorY] = ANCHORS[assembly] ?? [0, 0]
            const turnedX = anchorX * Math.cos(turn) - anchorY * Math.sin(turn)
            const turnedY = anchorX * Math.sin(turn) + anchorY * Math.cos(turn)
            const travel = TRACKING.has(assembly) ? DOLLY_TRAVEL * eased : 0
            const [screenX, screenY] = projectOffset(turnedX - anchorX + travel, turnedY - anchorY)
            part.setAttribute('transform', `translate(${screenX.toFixed(3)} ${screenY.toFixed(3)})`)
        }
    }
}

export const MOTIONS: Record<MotionName, (svg: SVGSVGElement) => Pose> = { aperture, record, studio }
