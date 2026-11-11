export interface PreviewAssistSettings {
    zebras: boolean
    /** Brightness (percent of full scale) at or above which zebra stripes appear. */
    zebraLevelPercent: number
    focusPeaking: boolean
    /** 1–100: higher marks softer edges too. */
    peakingSensitivity: number
}

export const DEFAULT_PREVIEW_ASSISTS: PreviewAssistSettings = {
    zebras: false,
    zebraLevelPercent: 95,
    focusPeaking: false,
    peakingSensitivity: 70,
}

/** Width of one black or white zebra stripe, in preview pixels. */
export const STRIPE_PIXELS = 4
/**
 * Focus peaking by edge width at single-pixel scale, independent of contrast. The preview is about an
 * eighth of the sensor's width, so a subject slightly out of focus is blurred by only a pixel or two here:
 * no smoothing may come first. For each direction, compare the change across the two pixels either side
 * of a point with the change across four. A focused edge makes all of its change within those two pixels
 * whatever its phase against the pixel grid (ratio 0.98–1); blurred by 1.3 pixels it reaches only 0.81–0.91,
 * by 1.5 pixels 0.77–0.87, however bright or dark it is. Noise is rejected twice: the span must stand well above the frame's noise
 * level, and a mark must touch another, since edges are lines and noise is isolated dots.
 */
/** Share of the span made in one step, needed at sensitivity 1 and at sensitivity 100. */
const PEAKING_RATIO_AT_LEAST_SENSITIVE = 0.99
const PEAKING_RATIO_AT_MOST_SENSITIVE = 0.85
/** How many noise levels above the frame's noise a span must be. */
const PEAKING_NOISE_MULTIPLE = 6
/** Floor for the noise level in perfectly clean frames, in 0–255 luma. */
const PEAKING_MINIMUM_NOISE = 0.75
const PEAKING_COLOR = [255, 48, 48] as const

function lumaOf(pixels: Uint8ClampedArray, width: number, height: number): Float32Array {
    const luma = new Float32Array(width * height)
    for (let pixel = 0; pixel < luma.length; pixel++) {
        const index = pixel * 4
        luma[pixel] = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
    }
    return luma
}

export function paintAssists(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    settings: PreviewAssistSettings,
    phase: number
): Uint8ClampedArray {
    const overlay = new Uint8ClampedArray(width * height * 4)
    const luma = lumaOf(pixels, width, height)
    if (settings.focusPeaking) paintPeaking(overlay, luma, width, height, peakingRatio(settings))
    if (settings.zebras) paintZebras(overlay, luma, width, height, (settings.zebraLevelPercent / 100) * 255, phase)
    return overlay
}

function peakingRatio(settings: PreviewAssistSettings): number {
    const sensitivity = Math.min(100, Math.max(1, settings.peakingSensitivity)) / 100
    const range = PEAKING_RATIO_AT_LEAST_SENSITIVE - PEAKING_RATIO_AT_MOST_SENSITIVE
    return PEAKING_RATIO_AT_LEAST_SENSITIVE - sensitivity * range
}

/** The median of a sample of values: most of any picture is flat, so this is its noise level. */
function medianOfSample(values: Float32Array, stride: number): number {
    const sample: number[] = []
    for (let index = 0; index < values.length; index += stride) sample.push(values[index])
    sample.sort((first, second) => first - second)
    return sample[sample.length >> 1] ?? 0
}

/** Along one direction (offset 1 for rows, width for columns): the change across 2 pixels and across 4. */
function edgeAlong(luma: Float32Array, center: number, offset: number): { step: number; span: number } {
    const step = Math.abs(luma[center + offset] - luma[center - offset])
    const span = Math.abs(luma[center + 2 * offset] - luma[center - 2 * offset])
    return { step, span }
}

/** Marks in red the pixels on edges no wider than the grid allows that stand clear of the noise. */
function paintPeaking(
    output: Uint8ClampedArray,
    luma: Float32Array,
    width: number,
    height: number,
    ratio: number
): void {
    const neighbourSteps = new Float32Array(luma.length)
    for (let pixel = 1; pixel < luma.length; pixel++) neighbourSteps[pixel] = Math.abs(luma[pixel] - luma[pixel - 1])
    const minimumSpan = Math.max(PEAKING_MINIMUM_NOISE, medianOfSample(neighbourSteps, 7)) * PEAKING_NOISE_MULTIPLE
    const sharp = new Uint8Array(luma.length)
    for (let row = 2; row < height - 2; row++) {
        for (let column = 2; column < width - 2; column++) {
            const center = row * width + column
            for (const offset of [1, width]) {
                const { step, span } = edgeAlong(luma, center, offset)
                if (span >= minimumSpan && step >= ratio * span) sharp[center] = 1
            }
        }
    }
    for (let row = 3; row < height - 3; row++) {
        for (let column = 3; column < width - 3; column++) {
            const center = row * width + column
            if (!sharp[center] || !hasSharpNeighbour(sharp, width, center)) continue
            const index = center * 4
            output[index] = PEAKING_COLOR[0]
            output[index + 1] = PEAKING_COLOR[1]
            output[index + 2] = PEAKING_COLOR[2]
            output[index + 3] = 255
        }
    }
}

function hasSharpNeighbour(sharp: Uint8Array, width: number, center: number): boolean {
    for (const offset of [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1]) {
        if (sharp[center + offset]) return true
    }
    return false
}

function paintZebras(
    output: Uint8ClampedArray,
    luma: Float32Array,
    width: number,
    height: number,
    level: number,
    phase: number
): void {
    for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
            const pixel = row * width + column
            if (luma[pixel] < level) continue
            const shade = Math.floor((column + row + phase) / STRIPE_PIXELS) % 2 === 0 ? 0 : 255
            const index = pixel * 4
            output[index] = output[index + 1] = output[index + 2] = shade
            output[index + 3] = 200
        }
    }
}
