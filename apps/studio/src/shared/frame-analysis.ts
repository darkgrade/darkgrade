/**
 * Measurements of a live-view frame in the terms a colourist reads off the scopes: the histogram
 * (exposure, clipping, headroom), the waveform (brightness across the picture) and the vectorscope
 * (colour cast and saturation), plus a sharpness reading. Pixels are 8-bit, gamma-encoded RGBA
 * (or BGRA with `blueFirst`), the way a decoded JPEG arrives.
 */

export interface FrameAnalysis {
    width: number
    height: number
    histogram: {
        /** Mean brightness, 0–100% (Rec. 709 luma of the encoded picture). */
        meanPercent: number
        /** Brightness below which 1%, 5%, 50%, 95% and 99% of the picture sits, in percent. */
        percentiles: { p1: number; p5: number; p50: number; p95: number; p99: number }
        /** Share of the picture at or near pure white (≥ 98%) and pure black (≤ 2%), in percent. */
        clippedHighlightsPercent: number
        crushedShadowsPercent: number
        /** Share of the picture in shadows (< 25%), midtones and highlights (> 75%), in percent. */
        zones: { shadowsPercent: number; midtonesPercent: number; highlightsPercent: number }
        /**
         * Stops of light the brightest 0.5% could gain before clipping (expose to the right). Near 0
         * means highlights are at the limit; negative values never occur, clipping shows above instead.
         */
        highlightHeadroomStops: number
        /** 64 bins of brightness from black to white, each the share of the picture in percent. */
        bins: number[]
    }
    waveform: {
        /** Brightness in the left, centre and right thirds of the picture: mean and peak, in percent. */
        thirds: { meanPercent: number; peakPercent: number }[]
    }
    vectorscope: {
        /** Average saturation, 0–100%. */
        meanSaturationPercent: number
        /** The picture's overall colour lean; near zero means neutral. Positive warm = orange, positive tint = magenta. */
        warmthPercent: number
        tintPercent: number
        /** Share of pixels saturated enough to risk clipping a colour channel, in percent. */
        oversaturatedPercent: number
    }
    sharpness: {
        /** Fine-detail energy in the centre third and the whole picture; higher is sharper. Compare readings, not absolute values. */
        centre: number
        overall: number
    }
}

const BIN_COUNT = 64
const CLIP_LEVEL = 0.98
const CRUSH_LEVEL = 0.02
const HEADROOM_PERCENTILE = 0.995
const OVERSATURATION_LEVEL = 0.85

function round(value: number, places = 1): number {
    const scale = 10 ** places
    return Math.round(value * scale) / scale
}

/** sRGB / Rec. 709 encoded value (0–1) to linear light. */
function toLinear(encoded: number): number {
    return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
}

function percentileFromCounts(counts: Uint32Array, total: number, fraction: number): number {
    const target = total * fraction
    let running = 0
    for (let level = 0; level < counts.length; level++) {
        running += counts[level]
        if (running >= target) return level / (counts.length - 1)
    }
    return 1
}

export function analyseFrame(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, blueFirst = false): FrameAnalysis {
    const total = width * height
    const lumaCounts = new Uint32Array(256)
    const luma = new Float32Array(total)
    const red = blueFirst ? 2 : 0
    const blue = blueFirst ? 0 : 2
    let saturationSum = 0
    let warmthSum = 0
    let tintSum = 0
    let oversaturated = 0
    const thirdSums = [0, 0, 0]
    const thirdPeaks = [0, 0, 0]
    const thirdCounts = [0, 0, 0]

    for (let index = 0; index < total; index++) {
        const offset = index * 4
        const r = pixels[offset + red] / 255
        const g = pixels[offset + 1] / 255
        const b = pixels[offset + blue] / 255
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
        luma[index] = y
        lumaCounts[Math.round(y * 255)]++
        const maximum = Math.max(r, g, b)
        const minimum = Math.min(r, g, b)
        const saturation = maximum === 0 ? 0 : (maximum - minimum) / maximum
        saturationSum += saturation
        if (saturation > OVERSATURATION_LEVEL && maximum > 0.2) oversaturated++
        warmthSum += r - b
        tintSum += (r + b) / 2 - g
        const third = Math.min(2, Math.floor(((index % width) * 3) / width))
        thirdSums[third] += y
        thirdCounts[third]++
        if (y > thirdPeaks[third]) thirdPeaks[third] = y
    }

    let clipped = 0
    let crushed = 0
    let shadows = 0
    let highlights = 0
    for (let level = 0; level < 256; level++) {
        const value = level / 255
        const count = lumaCounts[level]
        if (value >= CLIP_LEVEL) clipped += count
        if (value <= CRUSH_LEVEL) crushed += count
        if (value < 0.25) shadows += count
        if (value > 0.75) highlights += count
    }
    const bins = new Array<number>(BIN_COUNT).fill(0)
    for (let level = 0; level < 256; level++) bins[Math.floor((level * BIN_COUNT) / 256)] += lumaCounts[level]

    const brightest = percentileFromCounts(lumaCounts, total, HEADROOM_PERCENTILE)
    const headroom = brightest >= CLIP_LEVEL ? 0 : Math.log2(1 / Math.max(toLinear(brightest), 1e-4))
    const percent = (count: number): number => round((count / total) * 100)
    const at = (fraction: number): number => round(percentileFromCounts(lumaCounts, total, fraction) * 100)
    const meanLuma = luma.reduce((sum, value) => sum + value, 0) / total

    return {
        width,
        height,
        histogram: {
            meanPercent: round(meanLuma * 100),
            percentiles: { p1: at(0.01), p5: at(0.05), p50: at(0.5), p95: at(0.95), p99: at(0.99) },
            clippedHighlightsPercent: percent(clipped),
            crushedShadowsPercent: percent(crushed),
            zones: {
                shadowsPercent: percent(shadows),
                midtonesPercent: percent(total - shadows - highlights),
                highlightsPercent: percent(highlights),
            },
            highlightHeadroomStops: round(headroom, 2),
            bins: bins.map(count => round((count / total) * 100, 2)),
        },
        waveform: {
            thirds: thirdSums.map((sum, third) => ({
                meanPercent: round((sum / Math.max(1, thirdCounts[third])) * 100),
                peakPercent: round(thirdPeaks[third] * 100),
            })),
        },
        vectorscope: {
            meanSaturationPercent: round((saturationSum / total) * 100),
            warmthPercent: round((warmthSum / total) * 100),
            tintPercent: round((tintSum / total) * 100),
            oversaturatedPercent: percent(oversaturated),
        },
        sharpness: { centre: round(detailEnergy(luma, width, height, true), 2), overall: round(detailEnergy(luma, width, height, false), 2) },
    }
}

/** Mean squared Laplacian of brightness, scaled to readable numbers: more fine detail, higher value. */
function detailEnergy(luma: Float32Array, width: number, height: number, centreOnly: boolean): number {
    const left = centreOnly ? Math.floor(width / 3) : 1
    const right = centreOnly ? Math.ceil((width * 2) / 3) : width - 1
    const top = centreOnly ? Math.floor(height / 3) : 1
    const bottom = centreOnly ? Math.ceil((height * 2) / 3) : height - 1
    let sum = 0
    let count = 0
    for (let y = Math.max(1, top); y < Math.min(height - 1, bottom); y++) {
        for (let x = Math.max(1, left); x < Math.min(width - 1, right); x++) {
            const index = y * width + x
            const laplacian = 4 * luma[index] - luma[index - 1] - luma[index + 1] - luma[index - width] - luma[index + width]
            sum += laplacian * laplacian
            count++
        }
    }
    return count === 0 ? 0 : (sum / count) * 10_000
}
