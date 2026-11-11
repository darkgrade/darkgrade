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
    peakingSensitivity: 30,
}

/** Width of one black or white zebra stripe, in preview pixels. */
export const STRIPE_PIXELS = 4
/**
 * Focus peaking by fine detail, measured on real A7 V frames (one focused on the background, one on a face).
 * In focus, texture such as stubble, fabric or leather grain changes brightness within a pixel or two and often
 * reverses direction, so the change across two pixels exceeds the change across four. Defocus, even 1–2 preview
 * pixels of it, smooths that away: the two-pixel change shrinks and the four-pixel change catches up. A pixel is
 * marked where its two-pixel change is well above the frame's noise and at least 1.5 times its four-pixel change.
 * On those frames this marked in-focus areas about six times as often as the same areas out of focus.
 */
const PEAKING_DETAIL_RATIO = 1.5
/** How many times the frame's typical one-pixel change a two-pixel change must be, at sensitivity 1 and 100. */
const PEAKING_NOISE_MULTIPLE_AT_LEAST_SENSITIVE = 14
const PEAKING_NOISE_MULTIPLE_AT_MOST_SENSITIVE = 6
/** Floor for the typical change in perfectly clean frames, in 0–255 luma. */
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
    if (settings.focusPeaking) paintPeaking(overlay, luma, width, height, peakingNoiseMultiple(settings))
    if (settings.zebras) paintZebras(overlay, luma, width, height, (settings.zebraLevelPercent / 100) * 255, phase)
    return overlay
}

function peakingNoiseMultiple(settings: PreviewAssistSettings): number {
    const sensitivity = Math.min(100, Math.max(1, settings.peakingSensitivity)) / 100
    const range = PEAKING_NOISE_MULTIPLE_AT_LEAST_SENSITIVE - PEAKING_NOISE_MULTIPLE_AT_MOST_SENSITIVE
    return PEAKING_NOISE_MULTIPLE_AT_LEAST_SENSITIVE - sensitivity * range
}

/** The median of a sample of values: most of any picture is flat, so this is its noise level. */
function medianOfSample(values: Float32Array, stride: number): number {
    const sample: number[] = []
    for (let index = 0; index < values.length; index += stride) sample.push(values[index])
    sample.sort((first, second) => first - second)
    return sample[sample.length >> 1] ?? 0
}

/** Marks in red the pixels with in-focus fine detail: a large two-pixel change that beats the four-pixel one. */
function paintPeaking(
    output: Uint8ClampedArray,
    luma: Float32Array,
    width: number,
    height: number,
    noiseMultiple: number
): void {
    const neighbourSteps = new Float32Array(luma.length)
    for (let pixel = 1; pixel < luma.length; pixel++) neighbourSteps[pixel] = Math.abs(luma[pixel] - luma[pixel - 1])
    const minimumStep = Math.max(PEAKING_MINIMUM_NOISE, medianOfSample(neighbourSteps, 7)) * noiseMultiple
    for (let row = 2; row < height - 2; row++) {
        for (let column = 2; column < width - 2; column++) {
            const center = row * width + column
            if (!hasFineDetail(luma, center, 1, minimumStep) && !hasFineDetail(luma, center, width, minimumStep))
                continue
            const index = center * 4
            output[index] = PEAKING_COLOR[0]
            output[index + 1] = PEAKING_COLOR[1]
            output[index + 2] = PEAKING_COLOR[2]
            output[index + 3] = 255
        }
    }
}

/** Along one direction (offset 1 for rows, width for columns): a large two-pixel change that beats the four-pixel one. */
function hasFineDetail(luma: Float32Array, center: number, offset: number, minimumStep: number): boolean {
    const step = Math.abs(luma[center + offset] - luma[center - offset])
    if (step < minimumStep) return false
    return step >= PEAKING_DETAIL_RATIO * Math.abs(luma[center + 2 * offset] - luma[center - 2 * offset])
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
