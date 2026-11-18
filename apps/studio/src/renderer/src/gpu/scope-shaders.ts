import { FULLSCREEN_VERTEX } from '@renderer/gpu/device'

/**
 * The scopes on the GPU, each in three compute steps and one draw:
 * - accumulate: every pixel of the frame texture adds itself to bins (atomic counts), on each new frame;
 * - resolve: the bins become the scope's target values, scaled as before, on each new frame;
 * - ease: the shown values move a step toward the target on every draw, so the trace glides between frames;
 * - draw: the trace and its graticule, at the canvas's own resolution.
 */
export interface ScopeShader {
    /** How many bins, and how many values the target and shown buffers hold. */
    bins: number
    values: number
    compute: string
    draw: string
    /** Workgroups for resolve, given the value count. */
    resolveGroups: number
}

const COMPUTE_PRELUDE = /* wgsl */ `
struct Uniforms { size: vec2f, pixelRatio: f32, easing: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var frameTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> bins: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> goal: array<f32>;
@group(0) @binding(4) var<storage, read_write> shown: array<f32>;

@compute @workgroup_size(64) fn ease(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= arrayLength(&shown)) { return; }
    shown[id.x] += (goal[id.x] - shown[id.x]) * u.easing;
}
`

const DRAW_PRELUDE = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct Uniforms { size: vec2f, pixelRatio: f32, easing: f32 }
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(4) var<storage, read> shown: array<f32>;
const GRATICULE = vec4f(0.09, 0.09, 0.09, 0.09);
fn line(distance: f32) -> f32 { return clamp(0.5 * u.pixelRatio + 0.5 - abs(distance), 0.0, 1.0); }
`

const HISTOGRAM_BINS = 96
/** Per-channel histograms, smoothed over two neighbours each side and square-rooted, as camera histograms are. */
export const HISTOGRAM: ScopeShader = {
    bins: HISTOGRAM_BINS * 3,
    values: HISTOGRAM_BINS * 3,
    resolveGroups: 1,
    compute: /* wgsl */ `${COMPUTE_PRELUDE}
const BINS = ${HISTOGRAM_BINS}u;
var<workgroup> local: array<atomic<u32>, ${HISTOGRAM_BINS * 3}>;

@compute @workgroup_size(16, 16) fn accumulate(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) lane: u32) {
    for (var index = lane; index < BINS * 3u; index += 256u) { atomicStore(&local[index], 0u); }
    workgroupBarrier();
    let size = textureDimensions(frameTexture);
    if (id.x < size.x && id.y < size.y) {
        let rgb = textureLoad(frameTexture, id.xy, 0).rgb;
        for (var channel = 0u; channel < 3u; channel++) {
            let bin = min(BINS - 1u, (u32(rgb[channel] * 255.0 + 0.5) * BINS) >> 8u);
            atomicAdd(&local[channel * BINS + bin], 1u);
        }
    }
    workgroupBarrier();
    for (var index = lane; index < BINS * 3u; index += 256u) {
        let count = atomicLoad(&local[index]);
        if (count > 0u) { atomicAdd(&bins[index], count); }
    }
}

@compute @workgroup_size(1) fn resolve() {
    _ = textureDimensions(frameTexture);
    var peak = 0.0;
    for (var index = 0u; index < BINS * 3u; index++) {
        let channel = index / BINS;
        let bin = i32(index % BINS);
        var sum = 0.0;
        var count = 0.0;
        for (var offset = -2; offset <= 2; offset++) {
            let neighbour = bin + offset;
            if (neighbour < 0 || neighbour >= i32(BINS)) { continue; }
            sum += f32(atomicLoad(&bins[channel * BINS + u32(neighbour)]));
            count += 1.0;
        }
        goal[index] = sqrt(sum / count);
        peak = max(peak, goal[index]);
    }
    for (var index = 0u; index < BINS * 3u; index++) { goal[index] = select(0.0, goal[index] / peak, peak > 0.0); }
}
`,
    draw: /* wgsl */ `${DRAW_PRELUDE}
const BINS = ${HISTOGRAM_BINS};
const FILLS = array<vec4f, 3>(vec4f(1.0, 0.275, 0.275, 0.2), vec4f(0.235, 0.784, 0.392, 0.2), vec4f(0.196, 0.51, 1.0, 0.24));
const STROKES = array<vec3f, 3>(vec3f(1.0, 0.36, 0.36), vec3f(0.33, 0.84, 0.47), vec3f(0.275, 0.59, 1.0));

/** A smooth curve through the bins (Catmull-Rom), 0-1. */
fn level(channel: i32, position: f32) -> f32 {
    let base = i32(floor(position));
    let t = position - f32(base);
    let p0 = shown[channel * BINS + clamp(base - 1, 0, BINS - 1)];
    let p1 = shown[channel * BINS + clamp(base, 0, BINS - 1)];
    let p2 = shown[channel * BINS + clamp(base + 1, 0, BINS - 1)];
    let p3 = shown[channel * BINS + clamp(base + 2, 0, BINS - 1)];
    return max(0.0, 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t));
}

@fragment fn fragmentMain(v: Varyings) -> @location(0) vec4f {
    let pixel = v.uv * u.size;
    var colour = vec4f(0.0);
    for (var quarter = 1.0; quarter < 4.0; quarter += 1.0) { colour += GRATICULE * line(pixel.x - quarter / 4.0 * u.size.x); }
    let rise = u.size.y - pixel.y;
    let headroom = 10.0 * u.pixelRatio;
    for (var channel = 0; channel < 3; channel++) {
        let height = level(channel, v.uv.x * f32(BINS - 1)) * (u.size.y - headroom);
        if (rise < height) { colour += vec4f(FILLS[channel].rgb * FILLS[channel].a, FILLS[channel].a); }
        colour += vec4f(STROKES[channel], 1.0) * line(rise - height);
    }
    return min(colour, vec4f(1.0));
}
`,
}

const WAVE_COLUMNS = 160
const WAVE_ROWS = 100
/** RGB overlay waveform as Resolve draws it: where each column's red, green and blue sit from black to white. */
export const WAVEFORM: ScopeShader = {
    bins: WAVE_COLUMNS * WAVE_ROWS * 3,
    values: WAVE_COLUMNS * WAVE_ROWS * 3,
    resolveGroups: Math.ceil((WAVE_COLUMNS * WAVE_ROWS * 3) / 64),
    compute: /* wgsl */ `${COMPUTE_PRELUDE}
const COLUMNS = ${WAVE_COLUMNS}u;
const ROWS = ${WAVE_ROWS}u;
const GAIN = 14.0;

@compute @workgroup_size(16, 16) fn accumulate(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(frameTexture);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let rgb = textureLoad(frameTexture, id.xy, 0).rgb;
    let column = min(COLUMNS - 1u, id.x * COLUMNS / size.x);
    for (var channel = 0u; channel < 3u; channel++) {
        let row = ROWS - 1u - min(ROWS - 1u, u32(rgb[channel] * 255.0 + 0.5) * ROWS / 256u);
        atomicAdd(&bins[(row * COLUMNS + column) * 3u + channel], 1u);
    }
}

@compute @workgroup_size(64) fn resolve(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= COLUMNS * ROWS * 3u) { return; }
    let size = vec2f(textureDimensions(frameTexture));
    let perColumn = size.x * size.y / f32(COLUMNS);
    goal[id.x] = min(1.0, pow(f32(atomicLoad(&bins[id.x])) / perColumn * GAIN, 0.6));
}
`,
    draw: /* wgsl */ `${DRAW_PRELUDE}
const COLUMNS = ${WAVE_COLUMNS};
const ROWS = ${WAVE_ROWS};

fn cell(column: i32, row: i32) -> vec3f {
    let index = (clamp(row, 0, ROWS - 1) * COLUMNS + clamp(column, 0, COLUMNS - 1)) * 3;
    return vec3f(shown[index], shown[index + 1], shown[index + 2]);
}

@fragment fn fragmentMain(v: Varyings) -> @location(0) vec4f {
    let pixel = v.uv * u.size;
    let padding = 6.0 * u.pixelRatio;
    let plot = u.size.y - padding * 2.0;
    var colour = vec4f(0.0);
    for (var quarter = 0.0; quarter <= 4.0; quarter += 1.0) { colour += GRATICULE * line(pixel.y - (padding + quarter / 4.0 * plot)); }
    let position = vec2f(v.uv.x * f32(COLUMNS), (pixel.y - padding) / plot * f32(ROWS)) - 0.5;
    if (position.y < -0.5 || position.y > f32(ROWS) - 0.5) { return colour; }
    let base = vec2i(floor(position));
    let t = fract(position);
    let rgb = mix(mix(cell(base.x, base.y), cell(base.x + 1, base.y), t.x), mix(cell(base.x, base.y + 1), cell(base.x + 1, base.y + 1), t.x), t.y);
    let strongest = max(rgb.r, max(rgb.g, rgb.b));
    let tinted = min(vec3f(1.0), rgb + vec3f((rgb.g + rgb.b) * 0.12, (rgb.r + rgb.b) * 0.12, (rgb.r + rgb.g) * 0.18));
    return min(colour + vec4f(tinted * strongest, strongest), vec4f(1.0));
}
`,
}

const GRID = 120
/** Resolve's colour targets at 75%, as BT.709 Cb/Cr, and its skin-tone line 123° counter-clockwise from +Cb. */
const TARGETS = [
    [0.75, 0, 0],
    [0.75, 0, 0.75],
    [0, 0, 0.75],
    [0, 0.75, 0.75],
    [0, 0.75, 0],
    [0.75, 0.75, 0],
].map(([red, green, blue]) => {
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return [(blue - luma) / 1.8556, (red - luma) / 1.5748]
})
export const VECTORSCOPE_TARGETS = TARGETS
export const VECTORSCOPE_LABELS = ['R', 'Mg', 'B', 'Cy', 'G', 'Yl']

/** Where each pixel's hue and saturation fall, with each cell's density and the average colour of its pixels. */
export const VECTORSCOPE: ScopeShader = {
    bins: GRID * GRID * 4,
    values: GRID * GRID * 4,
    resolveGroups: Math.ceil((GRID * GRID) / 64),
    compute: /* wgsl */ `${COMPUTE_PRELUDE}
const GRID = ${GRID}u;
const RANGE = 0.5;
const GAIN = 22.0;

@compute @workgroup_size(16, 16) fn accumulate(@builtin(global_invocation_id) id: vec3u) {
    let size = textureDimensions(frameTexture);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let rgb = textureLoad(frameTexture, id.xy, 0).rgb;
    let luma = dot(rgb, vec3f(0.2126, 0.7152, 0.0722));
    let chroma = vec2f((rgb.b - luma) / 1.8556, (rgb.r - luma) / 1.5748);
    let column = i32(floor((chroma.x / RANGE + 1.0) / 2.0 * f32(GRID - 1u)));
    let row = i32(floor((1.0 - chroma.y / RANGE) / 2.0 * f32(GRID - 1u)));
    if (column < 0 || column >= i32(GRID) || row < 0 || row >= i32(GRID)) { return; }
    let index = (u32(row) * GRID + u32(column)) * 4u;
    let bytes = vec3u(rgb * 255.0 + 0.5);
    atomicAdd(&bins[index], 1u);
    atomicAdd(&bins[index + 1u], bytes.r);
    atomicAdd(&bins[index + 2u], bytes.g);
    atomicAdd(&bins[index + 3u], bytes.b);
}

@compute @workgroup_size(64) fn resolve(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= GRID * GRID) { return; }
    let index = id.x * 4u;
    let count = f32(atomicLoad(&bins[index]));
    if (count == 0.0) { goal[index] = 0.0; goal[index + 1u] = 0.0; goal[index + 2u] = 0.0; goal[index + 3u] = 0.0; return; }
    let size = vec2f(textureDimensions(frameTexture));
    let average = vec3f(f32(atomicLoad(&bins[index + 1u])), f32(atomicLoad(&bins[index + 2u])), f32(atomicLoad(&bins[index + 3u]))) / (count * 255.0);
    let brightest = max(max(average.r, average.g), max(average.b, 0.001));
    goal[index] = min(1.0, sqrt(count / (size.x * size.y) * GAIN * f32(GRID)));
    goal[index + 1u] = average.r / brightest;
    goal[index + 2u] = average.g / brightest;
    goal[index + 3u] = average.b / brightest;
}
`,
    draw: /* wgsl */ `${DRAW_PRELUDE}
const GRID = ${GRID};
const RANGE = 0.5;
const TARGETS = array<vec2f, 6>(${TARGETS.map(([cb, cr]) => `vec2f(${cb.toFixed(5)}, ${cr.toFixed(5)})`).join(', ')});

fn cell(column: i32, row: i32) -> vec4f {
    let index = (clamp(row, 0, GRID - 1) * GRID + clamp(column, 0, GRID - 1)) * 4;
    return vec4f(shown[index], shown[index + 1], shown[index + 2], shown[index + 3]);
}

@fragment fn fragmentMain(v: Varyings) -> @location(0) vec4f {
    let pixel = v.uv * u.size;
    let centre = u.size * 0.5;
    let radius = (min(u.size.x, u.size.y) - 12.0 * u.pixelRatio) * 0.5;
    let offset = pixel - centre;
    var colour = vec4f(0.0);
    colour += GRATICULE * line(length(offset) - radius);
    if (abs(offset.x) <= radius) { colour += GRATICULE * line(offset.y); }
    if (abs(offset.y) <= radius) { colour += GRATICULE * line(offset.x); }
    let skin = vec2f(cos(radians(123.0)), -sin(radians(123.0)));
    let along = dot(offset, skin);
    if (along > 0.0 && along < radius) { colour += vec4f(0.16) * line(offset.x * skin.y - offset.y * skin.x); }
    for (var mark = 0; mark < 6; mark++) {
        let point = centre + vec2f(TARGETS[mark].x, -TARGETS[mark].y) / RANGE * radius;
        let box = abs(pixel - point) - 5.0 * u.pixelRatio;
        colour += vec4f(0.22) * line(max(box.x, box.y));
    }
    let chroma = vec2f(offset.x, -offset.y) / radius * RANGE;
    let position = vec2f((chroma.x / RANGE + 1.0) / 2.0, (1.0 - chroma.y / RANGE) / 2.0) * f32(GRID - 1);
    if (any(position < vec2f(0.0)) || any(position > vec2f(f32(GRID - 1)))) { return min(colour, vec4f(1.0)); }
    let base = vec2i(floor(position));
    let t = fract(position);
    let value = mix(mix(cell(base.x, base.y), cell(base.x + 1, base.y), t.x), mix(cell(base.x, base.y + 1), cell(base.x + 1, base.y + 1), t.x), t.y);
    let density = value.x;
    let rgb = min(vec3f(1.0), value.yzw + density * density * 0.3);
    return min(colour + vec4f(rgb * density, density), vec4f(1.0));
}
`,
}
