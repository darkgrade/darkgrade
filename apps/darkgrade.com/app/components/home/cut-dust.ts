import {
    BufferAttribute,
    BufferGeometry,
    CustomBlending,
    OneFactor,
    OneMinusSrcAlphaFactor,
    Points,
    ShaderMaterial,
    Vector3,
    Vector4,
} from 'three'

/** A surface to scatter points over: its corners, already where they should stand, and its triangles. */
export interface DustSurface {
    positions: Float32Array
    triangles: ArrayLike<number>
    /** How many times the points its area would draw. */
    weight: number
    /** 0 for cream, 1 for gold. */
    tint: number
}

export interface Dust {
    points: Points
    material: ShaderMaterial
}

/** The two colours of the dust, as red, green and blue from 0 to 1. The gold is a little deeper than the gold of lines and words, as light is at its edge. */
export const DUST_COLOURS = {
    cream: [0.918, 0.902, 0.863],
    gold: [0.962, 0.773, 0.477],
} as const

/** How much wider than its core a dot's sprite is, to hold its halo. */
const HALO = 3.2
/** How wide a dot's sprite is, in CSS pixels. */
export const DUST_SPRITE_PIXELS = 5.8

/** A steady source of numbers from 0 to 1, so every visit draws the same dust. */
function randomSource(seed: number): () => number {
    let state = seed
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
    }
}

/** The area of a surface's triangles, added up one after another, so a number up to the total picks a triangle by its size. */
function runningAreas(surface: DustSurface): Float64Array {
    const { positions, triangles } = surface
    const running = new Float64Array(triangles.length / 3)
    let total = 0
    for (let triangle = 0; triangle < running.length; triangle++) {
        const [first, second, third] = [
            triangles[triangle * 3] * 3,
            triangles[triangle * 3 + 1] * 3,
            triangles[triangle * 3 + 2] * 3,
        ]
        const [sideX, sideY, sideZ] = [
            positions[second] - positions[first],
            positions[second + 1] - positions[first + 1],
            positions[second + 2] - positions[first + 2],
        ]
        const [otherX, otherY, otherZ] = [
            positions[third] - positions[first],
            positions[third + 1] - positions[first + 1],
            positions[third + 2] - positions[first + 2],
        ]
        total +=
            Math.hypot(
                sideY * otherZ - sideZ * otherY,
                sideZ * otherX - sideX * otherZ,
                sideX * otherY - sideY * otherX
            ) / 2
        running[triangle] = total
    }
    return running
}

function firstReaching(running: Float64Array, value: number): number {
    let low = 0
    let high = running.length - 1
    while (low < high) {
        const middle = (low + high) >> 1
        if (running[middle] < value) low = middle + 1
        else high = middle
    }
    return low
}

/** `count` points spread evenly by area over some surfaces: where each stands, three numbers of its own from 0 to 1, and its tint. */
function scatterOver(surfaces: DustSurface[], count: number): BufferGeometry {
    const random = randomSource(20261112)
    const areas = surfaces.map(runningAreas)
    const running = new Float64Array(surfaces.length)
    let total = 0
    surfaces.forEach((surface, index) => {
        total += (areas[index][areas[index].length - 1] ?? 0) * surface.weight
        running[index] = total
    })
    const places = new Float32Array(count * 3)
    const seeds = new Float32Array(count * 3)
    const tints = new Float32Array(count)
    for (let point = 0; point < count; point++) {
        const chosen = firstReaching(running, random() * total)
        const { positions, triangles, tint } = surfaces[chosen]
        const triangle = firstReaching(areas[chosen], random() * areas[chosen][areas[chosen].length - 1])
        const corners = [triangles[triangle * 3] * 3, triangles[triangle * 3 + 1] * 3, triangles[triangle * 3 + 2] * 3]
        const [drawnOne, drawnTwo] = [random(), random()]
        // Folding the unit square onto the triangle keeps the points even across it.
        const [alongSide, alongOther] = drawnOne + drawnTwo > 1 ? [1 - drawnOne, 1 - drawnTwo] : [drawnOne, drawnTwo]
        for (let axis = 0; axis < 3; axis++) {
            const origin = positions[corners[0] + axis]
            places[point * 3 + axis] =
                origin +
                (positions[corners[1] + axis] - origin) * alongSide +
                (positions[corners[2] + axis] - origin) * alongOther
            seeds[point * 3 + axis] = random()
        }
        tints[point] = tint
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(places, 3))
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3))
    geometry.setAttribute('aTint', new BufferAttribute(tints, 1))
    return geometry
}

const FRAGMENT = /* glsl */ `
    uniform vec3 uCream;
    uniform vec3 uGold;
    varying float vGold;
    varying float vLight;
    void main() {
        float distanceOut = length(gl_PointCoord * 2.0 - 1.0) * ${HALO.toFixed(1)};
        float core = 1.0 - smoothstep(0.75, 1.2, distanceOut);
        float halo = 0.2 * pow(max(0.0, 1.0 - distanceOut / ${HALO.toFixed(1)}), 2.0);
        float alpha = max(core, halo) * vLight * 0.36;
        // Light adds up where points crowd, but each also hides a little of what is behind it, so a crowd glows in its own colour and never burns out to white.
        gl_FragColor = vec4(mix(uCream, uGold, vGold) * alpha, alpha * 0.62);
    }
`

function dustOf(geometry: BufferGeometry, vertexShader: string, uniforms: Record<string, { value: unknown }>): Dust {
    const material = new ShaderMaterial({
        vertexShader,
        fragmentShader: FRAGMENT,
        // Written straight to the screen, so these are the colours as seen, not as three.js would convert them.
        uniforms: {
            uCream: { value: new Vector3(...DUST_COLOURS.cream) },
            uGold: { value: new Vector3(...DUST_COLOURS.gold) },
            uTime: { value: 0 },
            uSize: { value: 6 },
            uOpacity: { value: 0 },
            ...uniforms,
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
    })
    const points = new Points(geometry, material)
    points.frustumCulled = false
    return { points, material }
}

const SETTLING_VERTEX = /* glsl */ `
    attribute vec3 aSeed;
    attribute float aTint;
    uniform float uTime;
    uniform float uSize;
    uniform float uOpacity;
    uniform float uScatter;
    uniform float uReach;
    varying float vGold;
    varying float vLight;
    void main() {
        // Each point is thrown its own way and comes home at its own moment, the nearest first.
        float away = clamp(uScatter * 1.5 - aSeed.x * 0.5, 0.0, 1.0);
        away = away * away * (3.0 - 2.0 * away);
        vec3 thrown = normalize(aSeed - 0.5 + vec3(0.0, 0.18, 0.0));
        vec3 current = vec3(sin(uTime * 0.8 + aSeed.y * 40.0), cos(uTime * 0.7 + aSeed.z * 40.0), sin(uTime * 0.6 + aSeed.x * 40.0));
        vec3 place = position + thrown * away * uReach * (0.35 + aSeed.y) + current * uReach * (0.004 + away * 0.07);
        vGold = aTint;
        vLight = uOpacity * (0.55 + aTint * 0.6) * (1.0 - away * 0.55);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(place, 1.0);
        gl_PointSize = uSize * (0.8 + aSeed.z * 0.4);
    }
`

/**
 * Points of light on some surfaces, which `uScatter` throws out into the dark around them
 * (1 thrown as far as `uReach` millimetres, 0 settled on the surface). `uOpacity` is how much of them shows.
 */
export function makeSettlingDust(count: number, surfaces: DustSurface[], reachMillimetres: number): Dust {
    return dustOf(scatterOver(surfaces, count), SETTLING_VERTEX, {
        uScatter: { value: 1 },
        uReach: { value: reachMillimetres },
    })
}

const RING_VERTEX = /* glsl */ `
    attribute vec3 aSeed;
    attribute float aTint;
    uniform float uTime;
    uniform float uSize;
    uniform float uOpacity;
    uniform float uWave;
    uniform float uRingIn;
    uniform float uDream;
    uniform vec3 uRingCentre;
    uniform vec3 uRingRight;
    uniform vec3 uRingUp;
    uniform float uRingRadius;
    uniform vec4 uStir;
    varying float vGold;
    varying float vLight;

    const float PI = 3.14159265;

    void main() {
        vec3 forward = cross(uRingRight, uRingUp);

        // The ring: most points in one bright band, the rest in fainter lanes outside it, all slowly circling.
        float lane = aSeed.z;
        float outside = smoothstep(0.7, 1.0, lane);
        float reach = 1.0 + (fract(lane * 9.37) - 0.5) * 0.07 + outside * outside * (0.12 + 1.1 * fract(lane * 23.1));
        float angle = aSeed.y * PI * 2.0 + uTime * 0.07 / pow(reach, 1.5);
        float bright = 0.62 + 0.38 * sin(angle * 3.0 - uTime * 0.5 + reach * 7.0);
        vec3 onRing = uRingCentre + ((uRingRight * cos(angle) + uRingUp * sin(angle)) + forward * (fract(lane * 5.71) - 0.5) * 0.25) * uRingRadius * reach;
        float ringLight = mix(1.05 * bright, 0.42, outside) * 0.64;
        float ringGold = 1.0 - outside * 0.5;

        // A wave runs up the camera from its back and puts each point out as it passes. A point that
        // is out takes its place in the ring, unseen, and is lit again there: so nothing is seen to fly.
        float passed = smoothstep(position.z - 2.0, position.z + 14.0, uWave);
        float inRing = step(0.995, passed);
        vec3 place = mix(position, onRing, inRing);

        // Nothing is ever quite still, and one point in ten is dust that hangs off the ring.
        float loose = smoothstep(0.9, 1.0, aSeed.z);
        vec3 wobble = vec3(sin(uTime * 0.9 + aSeed.y * 50.0), cos(uTime * 0.8 + aSeed.z * 70.0), sin(uTime * 0.7 + aSeed.x * 30.0));
        place += wobble * uRingRadius * (0.004 + loose * 0.068) * mix(0.3, 1.0, inRing);

        // The pointer stirs the ring like a hand through dust in a beam: pushed aside and swirled.
        vec3 fromPointer = place - uStir.xyz;
        float stirred = exp(-dot(fromPointer, fromPointer) / (uRingRadius * uRingRadius * 0.07)) * uStir.w * inRing;
        vec3 outward = normalize(fromPointer + forward * 0.0001);
        place += (outward * (0.3 + 1.4 * aSeed.y * aSeed.y) * 0.1 + cross(forward, outward) * 0.09 * sin(uTime * 1.7 + aSeed.z * 6.28)) * stirred * uRingRadius;

        // On the camera a point is cream, or gold on glass. In the ring the band comes up first, cream, as the last of
        // the camera goes: the lens's own rim, left standing. Then it turns to gold and the lanes outside it come up.
        float onCamera = (1.0 - passed) * (0.5 + aTint * 0.5);
        float inTheRing = uRingIn * mix(uDream, 1.0, 1.0 - outside) * ringLight * mix(0.42, 1.0, uDream) * (1.0 - loose * 0.45);
        vGold = mix(aTint, ringGold * uDream, inRing);
        vLight = uOpacity * mix(onCamera, inTheRing, inRing);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(place, 1.0);
        gl_PointSize = uSize;
    }
`

/**
 * Points of light on some surfaces that end as a ring of radius `uRingRadius` about `uRingCentre`,
 * lying in the plane of `uRingRight` and `uRingUp`. `uWave` is how far along the surfaces' own z
 * a wave has run that puts their points out, the lowest z first. `uRingIn` brings up the ring's
 * one bright band, cream, where the points that are out have gone; `uDream` then turns it gold
 * and brings up the fainter lanes around it. `uStir` is a point the ring is pushed away from,
 * and how hard.
 */
export function makeRingDust(count: number, surfaces: DustSurface[]): Dust {
    return dustOf(scatterOver(surfaces, count), RING_VERTEX, {
        uWave: { value: -1e6 },
        uRingIn: { value: 0 },
        uDream: { value: 0 },
        uRingCentre: { value: new Vector3() },
        uRingRight: { value: new Vector3(1, 0, 0) },
        uRingUp: { value: new Vector3(0, 1, 0) },
        uRingRadius: { value: 40 },
        uStir: { value: new Vector4() },
    })
}

const STREAM_VERTEX = /* glsl */ `
    attribute vec3 aSeed;
    uniform float uTime;
    uniform float uSize;
    uniform float uOpacity;
    uniform float uProgress;
    uniform vec3 uFrom;
    uniform vec3 uTo;
    varying float vGold;
    varying float vLight;
    void main() {
        // Each point leaves at its own moment, so the stream has a head and a tail.
        float along = clamp(uProgress * 1.7 - aSeed.x * 0.7, 0.0, 1.0);
        float eased = along * along * (3.0 - 2.0 * along);
        vec3 whole = uTo - uFrom;
        float span = length(whole);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 side = normalize(cross(whole, up) + 0.0001);
        float swell = sin(eased * 3.14159265);
        // Wide where it leaves the screen, a loose arc on the way, a point where it lands.
        vec3 spread = (side * (aSeed.y - 0.5) + up * (aSeed.z - 0.5)) * span * (0.34 * (1.0 - eased) * (1.0 - eased) + 0.1 * swell);
        vec3 place = mix(uFrom, uTo, eased) + up * span * 0.16 * swell + spread;
        vGold = 1.0;
        vLight = uOpacity * sin(along * 3.14159265) * (0.55 + aSeed.z * 0.6);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(place, 1.0);
        gl_PointSize = uSize * (0.7 + aSeed.y * 0.5);
    }
`

/**
 * A burst of points that leaves `uFrom`, arcs over and lands on `uTo` as `uProgress` goes from 0
 * to 1. Nothing shows before 0 or after 1.
 */
export function makeStreamDust(count: number): Dust {
    const random = randomSource(7)
    const seeds = Float32Array.from({ length: count * 3 }, () => random())
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 3))
    return dustOf(geometry, STREAM_VERTEX, {
        uProgress: { value: 2 },
        uFrom: { value: new Vector3() },
        uTo: { value: new Vector3() },
    })
}
