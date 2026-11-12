import type { FrameAnalysis } from '@shared/frame-analysis'

/** Mean brightness most scenes suit (the shooting guidance's 40–55%). */
const TARGET_MEAN_PERCENT = 45
const DARK_MEAN_PERCENT = 35
const BRIGHT_MEAN_PERCENT = 60
const CLIPPED_HIGHLIGHTS_LIMIT_PERCENT = 1
const CRUSHED_SHADOWS_LIMIT_PERCENT = 3
/** Room left below clipping after brightening, as exposing to the right recommends. */
const KEPT_HEADROOM_STOPS = 0.3
const LARGEST_STEP_STOPS = 2

export interface ExposureVerdict {
    verdict: 'too dark' | 'too bright' | 'good' | 'both ends clipped'
    /** The adjust_exposure step that fixes it: positive brightens, in thirds of a stop; 0 when good. */
    suggestedStops: number
}

function toThirds(stops: number): number {
    return Math.round(stops * 3) / 3
}

/**
 * Turns the histogram into a plain verdict and a step, so a small model doesn't have to read the
 * numbers itself (it once darkened a frame at 9% mean brightness with a third of it crushed).
 */
export function exposureVerdict(histogram: FrameAnalysis['histogram']): ExposureVerdict {
    const clipped = histogram.clippedHighlightsPercent > CLIPPED_HIGHLIGHTS_LIMIT_PERCENT
    const crushed = histogram.crushedShadowsPercent > CRUSHED_SHADOWS_LIMIT_PERCENT
    if (clipped && crushed) return { verdict: 'both ends clipped', suggestedStops: 0 }
    if (clipped || histogram.meanPercent > BRIGHT_MEAN_PERCENT) {
        const stops = Math.min(
            LARGEST_STEP_STOPS,
            Math.max(1 / 3, Math.log2(histogram.meanPercent / TARGET_MEAN_PERCENT))
        )
        return { verdict: 'too bright', suggestedStops: -toThirds(stops) }
    }
    if (!crushed && histogram.meanPercent >= DARK_MEAN_PERCENT) return { verdict: 'good', suggestedStops: 0 }
    const wanted = Math.log2(TARGET_MEAN_PERCENT / Math.max(1, histogram.meanPercent))
    const allowed = Math.max(1 / 3, histogram.highlightHeadroomStops - KEPT_HEADROOM_STOPS)
    return { verdict: 'too dark', suggestedStops: toThirds(Math.min(LARGEST_STEP_STOPS, wanted, allowed)) }
}
