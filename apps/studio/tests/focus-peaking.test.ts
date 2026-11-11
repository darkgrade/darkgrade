import { paintAssists } from '@renderer/scopes/preview-assists-painting'
import { describe, expect, it } from 'vitest'

const SIZE = 96

/** Deterministic noise so the tests don't flake. */
function noiseSource(seed: number): () => number {
    let state = seed
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0
        return state / 2 ** 32 - 0.5
    }
}

/** A grey picture whose brightness across each row is profile(column), plus noise of the given amplitude. */
function picture(profile: (column: number) => number, noiseAmplitude: number): Uint8ClampedArray {
    const random = noiseSource(7)
    const pixels = new Uint8ClampedArray(SIZE * SIZE * 4)
    for (let row = 0; row < SIZE; row++) {
        for (let column = 0; column < SIZE; column++) {
            const value = profile(column) + noiseAmplitude * random()
            const index = (row * SIZE + column) * 4
            pixels[index] = pixels[index + 1] = pixels[index + 2] = value
            pixels[index + 3] = 255
        }
    }
    return pixels
}

/** Brightness rising from low to high across an edge at the centre, blurred to the given width in pixels. */
function edge(low: number, high: number, blurPixels: number): (column: number) => number {
    return column => {
        const position = (column - SIZE / 2) / Math.max(blurPixels, 0.0001)
        return low + (high - low) / (1 + Math.exp(-4 * position))
    }
}

/**
 * Irregular fine grain across the middle third of each row, of the given contrast, optionally blurred by
 * a Gaussian of the given width in pixels, as a lens out of focus would.
 */
function texture(base: number, contrast: number, blurPixels: number): (column: number) => number {
    // Irregular grain (fixed per column), in the middle third only: real frames are mostly flat, which sets
    // the noise floor, and real texture such as leather or stubble is irregular.
    const random = noiseSource(11)
    const values = Array.from({ length: SIZE + 16 }, () => random() + 0.5)
    const grain = (column: number) =>
        column < SIZE / 3 || column >= (2 * SIZE) / 3 ? base : base + contrast * (values[column + 8] - 0.5)
    if (blurPixels === 0) return grain
    return column => {
        let sum = 0
        let weights = 0
        for (let tap = -4; tap <= 4; tap++) {
            const weight = Math.exp(-(tap * tap) / (2 * blurPixels * blurPixels))
            sum += weight * grain(column + tap)
            weights += weight
        }
        return sum / weights
    }
}

function peakedPixels(pixels: Uint8ClampedArray, sensitivity = 70): number {
    const settings = { zebras: false, zebraLevelPercent: 95, focusPeaking: true, peakingSensitivity: sensitivity }
    const overlay = paintAssists(pixels, SIZE, SIZE, settings, 0)
    let count = 0
    for (let index = 3; index < overlay.length; index += 4) if (overlay[index] === 255) count++
    return count
}

describe('focus peaking', () => {
    it('marks fine texture in focus, and far less of it once it is out of focus', () => {
        const sharp = peakedPixels(picture(texture(60, 20, 0), 1.5))
        const soft = peakedPixels(picture(texture(60, 20, 1.5), 1.5))
        expect(sharp).toBeGreaterThan(100)
        expect(sharp).toBeGreaterThanOrEqual(10 * Math.max(soft, 1))
    })

    it('ignores a blurred edge however strong its contrast (out-of-focus glasses)', () => {
        expect(peakedPixels(picture(edge(30, 230, 6), 1.5))).toBe(0)
    })

    it('ignores a subject blurred by only a pixel and a half (out of focus at preview size)', () => {
        // A stray noise pixel may pass; the edge itself must not be traced.
        expect(peakedPixels(picture(edge(60, 160, 1.5), 1.5), 70)).toBeLessThan(SIZE * 0.05)
    })

    it('ignores pure sensor noise', () => {
        expect(peakedPixels(picture(() => 60, 4))).toBe(0)
    })

    it('marks more at higher sensitivity on a slightly soft edge', () => {
        const slightlySoft = picture(edge(40, 120, 2), 1.5)
        expect(peakedPixels(slightlySoft, 100)).toBeGreaterThanOrEqual(peakedPixels(slightlySoft, 1))
    })
})
