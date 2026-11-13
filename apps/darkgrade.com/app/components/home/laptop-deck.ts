import { BufferGeometry, Float32BufferAttribute } from 'three'

/** The top of the laptop's base, in the laptop's own millimetres: x runs across it, z from the hinge towards the front edge. */
export interface LaptopDeck {
    halfWidth: number
    hingeZ: number
    frontZ: number
    topY: number
}

const KEYS = { across: 12, deep: 4 }
/** How much of the deck's width the keyboard takes, and how much of a key's pitch is the gap to the next. */
const KEYBOARD_SHARE_OF_WIDTH = 0.86
const GAP_SHARE_OF_PITCH = 0.14
const KEY_CORNER_MILLIMETRES = 3.2
/** Where the keyboard starts and the trackpad starts and ends, as shares of the way from the hinge to the front edge. */
const KEYBOARD_FROM = 0.07
const TRACKPAD = { from: 0.58, to: 0.93, shareOfWidth: 0.36, cornerMillimetres: 5 }
/** How many straight lines a rounded corner is drawn in. */
const CORNER_STEPS = 4
/** How far above the deck the lines are drawn, so the deck's own fill never covers them. */
const LIFT_MILLIMETRES = 0.4

/**
 * The keyboard and the trackpad as lines on the laptop's deck: twelve keys across and four deep,
 * each a rounded outline of its own, and one larger rounded outline below them. Made for LineSegments.
 */
export function deckMarkings(deck: LaptopDeck): BufferGeometry {
    const y = deck.topY + LIFT_MILLIMETRES
    const depth = deck.frontZ - deck.hingeZ
    const segments: number[] = []

    /** A rectangle with rounded corners: one point after another round it, each corner a quarter turn. */
    function outline(left: number, back: number, right: number, front: number, radius: number) {
        const corners = [
            [right - radius, back + radius, -90],
            [right - radius, front - radius, 0],
            [left + radius, front - radius, 90],
            [left + radius, back + radius, 180],
        ]
        const round: [number, number][] = []
        for (const [centreX, centreZ, startDegrees] of corners) {
            for (let step = 0; step <= CORNER_STEPS; step++) {
                const angle = ((startDegrees + (step / CORNER_STEPS) * 90) * Math.PI) / 180
                round.push([centreX + Math.cos(angle) * radius, centreZ + Math.sin(angle) * radius])
            }
        }
        round.forEach(([x, z], index) => {
            const [nextX, nextZ] = round[(index + 1) % round.length]
            segments.push(x, y, z, nextX, y, nextZ)
        })
    }

    // The keys are square: their pitch across the keyboard is their pitch down it.
    const pitch = (deck.halfWidth * 2 * KEYBOARD_SHARE_OF_WIDTH) / KEYS.across
    const gap = pitch * GAP_SHARE_OF_PITCH
    const keyboardLeft = (-pitch * KEYS.across) / 2
    const keyboardBack = deck.hingeZ + depth * KEYBOARD_FROM
    for (let row = 0; row < KEYS.deep; row++) {
        for (let column = 0; column < KEYS.across; column++) {
            const [left, back] = [keyboardLeft + column * pitch + gap / 2, keyboardBack + row * pitch + gap / 2]
            outline(left, back, left + pitch - gap, back + pitch - gap, KEY_CORNER_MILLIMETRES)
        }
    }

    const halfPad = deck.halfWidth * TRACKPAD.shareOfWidth
    outline(
        -halfPad,
        deck.hingeZ + depth * TRACKPAD.from,
        halfPad,
        deck.hingeZ + depth * TRACKPAD.to,
        TRACKPAD.cornerMillimetres
    )

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(segments, 3))
    return geometry
}
