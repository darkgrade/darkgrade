import {
    BufferAttribute,
    BufferGeometry,
    CustomBlending,
    MathUtils,
    OneFactor,
    OneMinusDstAlphaFactor,
    PerspectiveCamera,
    Points,
    Scene,
    ShaderMaterial,
    Vector3,
} from 'three'

import type { Frame } from '@/app/components/dust/viewport'

/** The two inks the dust is lit in, as darkgrade.com mixes them. */
const DUST_COLOURS = { cream: [0.918, 0.902, 0.863], gold: [0.962, 0.773, 0.477] } as const

/** Eases `current` toward `target` at a rate that does not care about the frame rate. */
function approach(current: number, target: number, ratePerSecond: number, deltaSeconds: number): number {
    return target + (current - target) * Math.exp(-ratePerSecond * deltaSeconds)
}

/** The few values of darkgrade.com's shot the dust reads. Here they are held still. */
export interface Shot {
    azimuth: number
    ink: number
    onScreen: number
    onLens: number
    ring: number
}

/**
 * Dust flowing behind the whole picture, along hundreds of long lines that lie one above another
 * from the foot of the page to its top. The lines all follow the same slow swells, so they move
 * as a cloth does, drawing together into bright folds and apart again, and every point travels
 * along its line. Each line lies at a depth of its own and the page is seen through a lens: the
 * lines at the focus distance are fine and sharp, the rest soft discs, nearer and further.
 * `position.x` is how far along its line a point starts, `position.y` which line, 0 to 1, and
 * `position.z` a number of its own.
 */
const VERTEX = /* glsl */ `
    uniform float uTime;
    uniform float uPhase;
    uniform vec2 uReach;
    uniform vec2 uLean;
    uniform float uAway;
    uniform float uFocus;
    uniform float uBlur;
    uniform float uProjection;
    uniform float uSize;
    uniform float uMostSize;
    uniform float uOpacity;
    uniform float uCalmLeft;
    varying float vLight;
    varying float vGold;
    varying float vOpen;

    void main() {
        float line = position.y;
        float depth = fract(line * 71.3) - 0.5;
        float pace = 0.004 + 0.007 * fract(line * 13.7);
        float along = fract(position.x + uTime * pace);
        vec2 at = vec2(along, line) * 2.0 - 1.0;
        float flow = uTime * 0.05 + uPhase;
        // the swells every line follows: neighbours bend together, so the lines read as one cloth
        float bend =
            sin(at.x * 1.7 + at.y * 2.3 + flow * 1.3) * 0.3 +
            sin(at.x * 3.2 - at.y * 1.5 - flow * 0.9 + 2.0) * 0.14 +
            sin(at.x * 0.8 + at.y * 4.6 + flow * 0.55) * 0.27;
        float fold = sin(at.x * 2.4 - at.y * 3.1 + flow * 0.8 + 1.0);

        vec3 place = vec3(
            at.x * uReach.x + uLean.x * depth * 1.2,
            (at.y * 1.2 + bend) * uReach.y + uLean.y * depth * 0.8,
            -(uAway + depth * 5.0 + fold * 1.3)
        );

        float away = max(0.05, -place.z);
        float circle = uBlur * abs(away - uFocus) / away * uProjection;
        float size = min(uMostSize, uSize + circle * 2.0);
        float spread = (uSize * uSize) / (size * size);
        // light runs along each line in long pulses, the way it runs along a thread
        float pulse = 0.5 + 0.5 * sin(along * 15.0 + line * 37.0 - uTime * 0.5);
        // one point in forty is a bright one: out of focus, these are the discs that are seen
        float own = 0.35 + 0.65 * position.z + 4.0 * step(0.975, fract(position.z * 57.3));
        // a line goes out before the place where its points come round again
        float ends = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
        vLight = uOpacity * own * (0.3 + 0.7 * pulse * pulse) * mix(spread, sqrt(spread), 0.55) * ends * smoothstep(0.6, 2.4, away);
        vGold = pulse * (0.3 + 0.6 * fract(line * 29.3));
        vOpen = smoothstep(1.5, 5.0, circle / uSize);
        gl_PointSize = size;
        gl_Position = projectionMatrix * vec4(place, 1.0);
        // the words stand on the left of a wide window: the dust is quieter behind them
        vLight *= mix(1.0, smoothstep(-1.1, 0.25, gl_Position.x / gl_Position.w), uCalmLeft);
    }
`

const FRAGMENT = /* glsl */ `
    uniform vec3 uCream;
    uniform vec3 uGold;
    varying float vLight;
    varying float vGold;
    varying float vOpen;
    void main() {
        float fromCentre = length(gl_PointCoord * 2.0 - 1.0);
        float speck = exp(-fromCentre * fromCentre * 3.4);
        float disc = (1.0 - smoothstep(0.78, 1.0, fromCentre)) * (0.8 + 0.3 * smoothstep(0.4, 0.9, fromCentre));
        float alpha = min(1.0, mix(speck, disc * 0.5, vOpen) * vLight);
        // colour and cover go together: the canvas is composed with its colour already multiplied by its cover, and a colour above its cover is cut down to it, channel by channel, which turns gold green
        gl_FragColor = vec4(mix(uCream, uGold, vGold) * alpha, alpha);
    }
`

/** How many points lie along a line, and how many lines there are. */
const GRID = { wide: [300, 170], narrow: [130, 120] }
const FIELD_OF_VIEW_DEGREES = 30
/** How far off the middle of the lines' depths is, in the backdrop's own units, and how far the lines reach either side of the middle of the page, across and up. */
const AWAY = 10
const REACH = { across: 7.6, up: 3.5 }
/** A point's disc out of focus, as a share of how far off it is. */
const BLUR = 0.018
const CSS_PIXELS_ACROSS_A_POINT = 1.7
/** How bright the sheet is, at most: it lies behind words. */
const OPACITY = 0.8

export interface Backdrop {
    scene: Scene
    camera: PerspectiveCamera
    /** Told every frame, with the shot as it is being held. */
    update(frame: Frame, shot: Readonly<Shot>): void
    dispose(): void
}

/** A steady source of numbers from 0 to 1, so every visit draws the same backdrop. */
function randomSource(seed: number): () => number {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * The backdrop of the home page: dust in the same cream and gold as the ring the page ends on,
 * flowing behind everything along lines that move as a cloth does. It is drawn after the picture
 * and only where the picture has left the canvas clear. Its swells roll on with time and a little further with every move the
 * viewer makes about the camera, its focus is pulled as those moves are made, and the pointer
 * leans it.
 */
export function makeBackdrop(): Backdrop {
    const [columns, rows] = innerWidth < 900 ? GRID.narrow : GRID.wide
    const random = randomSource(1113)
    const places = new Float32Array(columns * rows * 3)
    for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
            const point = (row * columns + column) * 3
            // points are shaken along their line, so it reads as dust; every point of a line shares its line exactly
            places[point] = (column + random()) / columns
            places[point + 1] = (row + 0.5) / rows
            places[point + 2] = random()
        }
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(places, 3))
    const material = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
            uCream: { value: new Vector3(...DUST_COLOURS.cream) },
            uGold: { value: new Vector3(...DUST_COLOURS.gold) },
            uTime: { value: 0 },
            uPhase: { value: 0 },
            uReach: { value: new Vector3(REACH.across, REACH.up, 0) },
            uLean: { value: new Vector3() },
            uAway: { value: AWAY },
            uFocus: { value: AWAY },
            uBlur: { value: BLUR },
            uProjection: { value: 1000 },
            uSize: { value: 4 },
            uMostSize: { value: 80 },
            uOpacity: { value: OPACITY },
            uCalmLeft: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // laid under whatever is already drawn: it shows only where the picture has left the canvas clear
        blending: CustomBlending,
        blendSrc: OneMinusDstAlphaFactor,
        blendDst: OneFactor,
        blendSrcAlpha: OneMinusDstAlphaFactor,
        blendDstAlpha: OneFactor,
    })
    const points = new Points(geometry, material)
    points.frustumCulled = false
    const scene = new Scene()
    scene.add(points)
    const camera = new PerspectiveCamera(FIELD_OF_VIEW_DEGREES, 1, 0.05, 100)
    const { uniforms } = material
    let focus = AWAY
    let phase: number | undefined
    let leanAcross = 0
    let leanDown = 0

    return {
        scene,
        camera,
        update(frame, shot) {
            const turned = MathUtils.degToRad(shot.azimuth)
            // every move the viewer makes about the camera rolls the swells on and pulls the focus through them
            const wantedPhase = turned * 0.55
            const wantedFocus = AWAY * (1 + 0.16 * Math.sin(turned * 1.3 + 0.6))
            phase =
                phase === undefined || frame.still ? wantedPhase : approach(phase, wantedPhase, 1.4, frame.deltaSeconds)
            focus = frame.still ? wantedFocus : approach(focus, wantedFocus, 1.4, frame.deltaSeconds)
            leanAcross = approach(leanAcross, frame.pointerSeen ? frame.pointer.x : 0, 2, frame.deltaSeconds)
            leanDown = approach(leanDown, frame.pointerSeen ? frame.pointer.y : 0, 2, frame.deltaSeconds)
            uniforms.uTime.value = frame.seconds
            uniforms.uPhase.value = phase
            uniforms.uFocus.value = focus
            ;(uniforms.uLean.value as Vector3).set(-leanAcross, leanDown, 0)
            // it steps back for the laptop's screen and for the closing ring
            uniforms.uOpacity.value = OPACITY * shot.ink * (1 - 0.6 * shot.onScreen) * (1 - 0.45 * shot.ring)

            uniforms.uCalmLeft.value = frame.cssWidth < 900 ? 0 : 0.6 * (1 - shot.onLens)
            const pixelRatio = frame.width / frame.cssWidth
            uniforms.uProjection.value = frame.height / (2 * Math.tan(MathUtils.degToRad(FIELD_OF_VIEW_DEGREES / 2)))
            uniforms.uSize.value = CSS_PIXELS_ACROSS_A_POINT * pixelRatio
            uniforms.uMostSize.value = 30 * pixelRatio
            camera.aspect = frame.width / frame.height
            camera.updateProjectionMatrix()
        },
        dispose() {
            geometry.dispose()
            material.dispose()
        },
    }
}
