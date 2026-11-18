import { FULLSCREEN_VERTEX } from '@renderer/gpu/device'

/** The recording red and the tally's shades of it (deeper, brighter or warmer, never yellow or pink). */
const RED = [232, 52, 64]
const SHADES = [
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
/** Fourteen soft patches round the edge: [edge (0 top, 1 right, 2 bottom, 3 left), at %, length, depth px]. */
const PATCHES: Array<[number, number, number, number]> = [
    [0, 8, 0.45, 40],
    [0, 38, 0.35, 60],
    [0, 64, 0.5, 35],
    [0, 91, 0.3, 55],
    [1, 16, 0.4, 50],
    [1, 50, 0.45, 38],
    [1, 84, 0.35, 58],
    [2, 86, 0.4, 42],
    [2, 56, 0.5, 60],
    [2, 26, 0.35, 45],
    [2, 5, 0.3, 52],
    [3, 80, 0.45, 50],
    [3, 46, 0.4, 36],
    [3, 13, 0.35, 56],
]

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value))
const patchColor = (index: number): string =>
    `vec3f(${RED.map((value, channel) => f(Math.min(255, Math.round(value * SHADES[index % SHADES.length][channel])) / 255)).join(', ')})`

/** A piecewise-linear ramp through [position, value] stops, 0 outside them, as a CSS conic gradient's stops are. */
function ramp(name: string, stops: Array<[number, number]>): string {
    const pieces = stops
        .slice(1)
        .map(([to, end], index) => {
            const [from, start] = stops[index]
            return `if (t < ${f(to / 100)}) { return mix(${f(start)}, ${f(end)}, (t - ${f(from / 100)}) / ${f((to - from) / 100)}); }`
        })
        .join('\n    ')
    return `fn ${name}(t: f32) -> f32 {\n    if (t < ${f(stops[0][0] / 100)}) { return 0.0; }\n    ${pieces}\n    return 0.0;\n}`
}

/**
 * One pass draws the picture and everything Studio lays over it, at the canvas's own resolution:
 * - the frame, filtered from its texture;
 * - focus peaking: a preview pixel whose two-pixel change is well above the frame's noise (its median one-pixel
 *   change, measured on the GPU) and at least 1.5 times its four-pixel change is marked red;
 * - zebras: diagonal black and white stripes, 4 preview pixels wide and moving, over pixels at or above the level;
 * - the camera's own on-screen display, stretched over the picture, when it's shown;
 * - the recording tally: a beam running round the frame's rounded edge, uncovering a 2px stroke (a white streak
 *   over red), a soft red glow inside it from fourteen drifting patches, and a white bloom along the stroke.
 */
export const PICTURE_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}

struct Uniforms {
    canvasSize: vec2f,      // CSS px
    frameSize: vec2f,       // preview px
    pixelRatio: f32,
    zebras: f32,
    zebraLevel: f32,        // 0-255
    zebraPhase: f32,
    peaking: f32,
    peakingNoiseMultiple: f32,
    tally: f32,             // 0-1 fade
    tallyAngle: f32,        // degrees
    tallyHue: f32,          // degrees
    radius: f32,            // CSS px
    osd: f32,               // the camera's own display over the picture
    _pad: f32,
    drift: vec4f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@group(0) @binding(2) var frameSampler: sampler;
@group(0) @binding(3) var<storage, read> noise: array<f32, 1>;
@group(0) @binding(4) var osdTexture: texture_2d<f32>;

fn lumaAt(texel: vec2i) -> f32 {
    let size = vec2i(u.frameSize);
    let rgb = textureLoad(frameTexture, clamp(texel, vec2i(0), size - 1), 0).rgb * 255.0;
    return dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
}

fn fineDetail(texel: vec2i, direction: vec2i, minimumStep: f32) -> bool {
    let step = abs(lumaAt(texel + direction) - lumaAt(texel - direction));
    if (step < minimumStep) { return false; }
    return step >= 1.5 * abs(lumaAt(texel + 2 * direction) - lumaAt(texel - 2 * direction));
}

${ramp('sweep', [
    [30, 0],
    [36, 0.1],
    [44, 0.35],
    [52, 1],
    [80, 1],
    [86, 0.35],
    [92, 0.1],
    [95, 0],
])}
${ramp('streak', [
    [54, 0],
    [57, 0.1],
    [60, 0.3],
    [63, 0.6],
    [66, 0.75],
    [69, 0.6],
    [72, 0.3],
    [75, 0.1],
    [78, 0],
])}
${ramp('bloom', [
    [58, 0],
    [62, 0.03],
    [65, 0.08],
    [67, 0.2],
    [69, 0.45],
    [70, 0.85],
    [70.5, 0.85],
    [71.5, 0.45],
    [73, 0.2],
    [75, 0.08],
    [78, 0.03],
    [82, 0],
])}

fn driftOf(index: u32) -> f32 { return u.drift[index % 4u]; }

/** The patches as CSS paints its stacked radial gradients (first on top), each fading linearly to its rim. */
fn patches(p: vec2f, alpha: f32, scale: f32) -> vec4f {
    var colour = vec4f(0.0);
    ${PATCHES.map(
        ([edge, at, length, depth], index) => `{
        let across = ${edge === 0 || edge === 2 ? 'true' : 'false'};
        let along = (${edge === 0 || edge === 2 ? 'u.canvasSize.x' : 'u.canvasSize.y'}) * ${f(length / 2)} * scale * (0.7 + 0.6 * driftOf(${index + 1}u));
        let inward = ${f(depth * 0.7)} * scale * (0.5 + driftOf(${index}u));
        let place = ${f(at / 100)} + 0.24 * (driftOf(${index + 2}u) - 0.5);
        let centre = ${['vec2f(place * u.canvasSize.x, 0.0)', 'vec2f(u.canvasSize.x, place * u.canvasSize.y)', 'vec2f(place * u.canvasSize.x, u.canvasSize.y)', 'vec2f(0.0, place * u.canvasSize.y)'][edge]};
        let radii = select(vec2f(inward, along), vec2f(along, inward), across);
        let r = length((p - centre) / max(radii, vec2f(0.001)));
        let a = alpha * max(0.0, 1.0 - r);
        colour = vec4f(colour.rgb + ${patchColor(index)} * a * (1.0 - colour.a), colour.a + a * (1.0 - colour.a));
    }`
    ).join('\n    ')}
    return colour;
}

/** CSS's hue-rotate(), brightness(1.25) and saturate(1.2), on premultiplied colour. */
fn light(colour: vec4f) -> vec4f {
    if (colour.a <= 0.0) { return colour; }
    var rgb = colour.rgb / colour.a;
    let angle = radians(u.tallyHue);
    let c = cos(angle);
    let s = sin(angle);
    let hue = mat3x3f(
        vec3f(0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787),
        vec3f(0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715),
        vec3f(0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072));
    rgb = hue * rgb * 1.25;
    let grey = dot(rgb, vec3f(0.213, 0.715, 0.072));
    rgb = clamp(mix(vec3f(grey), rgb, 1.2), vec3f(0.0), vec3f(1.0));
    return vec4f(rgb * colour.a, colour.a);
}

fn over(top: vec4f, bottom: vec4f) -> vec4f { return top + bottom * (1.0 - top.a); }

@fragment fn fragmentMain(v: Varyings) -> @location(0) vec4f {
    var colour = vec4f(textureSample(frameTexture, frameSampler, v.uv).rgb, 1.0);
    let display = textureSample(osdTexture, frameSampler, v.uv);
    let texel = vec2i(floor(v.uv * u.frameSize));

    if (u.peaking > 0.5) {
        let minimumStep = max(0.75, noise[0]) * u.peakingNoiseMultiple;
        if (fineDetail(texel, vec2i(1, 0), minimumStep) || fineDetail(texel, vec2i(0, 1), minimumStep)) {
            colour = vec4f(1.0, 48.0 / 255.0, 48.0 / 255.0, 1.0);
        }
    }
    if (u.zebras > 0.5 && lumaAt(texel) >= u.zebraLevel) {
        let shade = select(1.0, 0.0, (u32(floor((f32(texel.x + texel.y) + u.zebraPhase) / 4.0)) % 2u) == 0u);
        colour = over(vec4f(vec3f(shade), 1.0) * (200.0 / 255.0), colour);
    }

    if (u.osd > 0.5) { colour = over(display, colour); }

    if (u.tally > 0.0) {
        let p = v.uv * u.canvasSize;
        let middle = u.canvasSize * 0.5;
        let q = abs(p - middle) - (middle - u.radius);
        let depth = -(length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - u.radius);
        let offset = p - middle;
        let theta = degrees(atan2(offset.x, -offset.y));
        let t = fract((theta - u.tallyAngle) / 360.0 + 2.0);
        let uncovered = sweep(t);
        if (depth < 70.0 && uncovered > 0.0) {
            let glow = light(patches(p, 0.45, 0.9)) * uncovered * u.tally * 0.6;
            colour = over(glow, colour);
            if (depth < 2.0) {
                let streakColour = vec4f(1.0) * streak(t);
                let stroke = light(over(streakColour, patches(p, 1.0, 1.0))) * uncovered * u.tally * 0.85;
                colour = over(stroke, colour);
            }
        }
        let bloomAlpha = bloom(t) * exp(-(depth * depth) / 72.0) * u.tally * 0.5 * 0.6;
        colour = over(vec4f(vec3f(bloomAlpha), bloomAlpha), colour);
    }
    return colour;
}
`

/**
 * The frame's noise level for focus peaking: the median change between horizontal neighbours (every 7th pixel),
 * binned at quarter steps of 0-255 luma, then read off by one invocation walking the bins.
 */
export const NOISE_SHADER = /* wgsl */ `
@group(0) @binding(0) var frameTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 1024>;
@group(0) @binding(2) var<storage, read_write> noise: array<f32, 1>;

fn luma(texel: vec2u) -> f32 { return dot(textureLoad(frameTexture, texel, 0).rgb * 255.0, vec3f(0.2126, 0.7152, 0.0722)); }

@compute @workgroup_size(8, 8) fn binSteps(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(frameTexture);
    let texel = vec2u(id.x * 7u + 1u, id.y);
    if (texel.x >= size.x || texel.y >= size.y) { return; }
    let step = abs(luma(texel) - luma(texel - vec2u(1u, 0u)));
    atomicAdd(&bins[min(1023u, u32(step * 4.0))], 1u);
}

@compute @workgroup_size(1) fn median() {
    var total = 0u;
    for (var bin = 0u; bin < 1024u; bin++) { total += atomicLoad(&bins[bin]); }
    var seen = 0u;
    for (var bin = 0u; bin < 1024u; bin++) {
        seen += atomicLoad(&bins[bin]);
        if (seen * 2u >= total) { noise[0] = (f32(bin) + 0.5) / 4.0; return; }
    }
    noise[0] = 0.0;
}
`
