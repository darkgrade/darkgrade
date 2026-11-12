import { exposureVerdict } from '@shared/exposure-verdict'
import { describe, expect, it } from 'vitest'

/** analyze_frame's histogram from the 2026-11-12 12:15 voice session, where "Fix my exposure" darkened it. */
const DARK_ROOM_WITH_LAMP = {
    meanPercent: 9.4,
    percentiles: { p1: 0, p5: 0.4, p50: 4.7, p95: 36.9, p99: 79.2 },
    clippedHighlightsPercent: 0.2,
    crushedShadowsPercent: 32.2,
    zones: { shadowsPercent: 90.1, midtonesPercent: 8.7, highlightsPercent: 1.2 },
    highlightHeadroomStops: 0.27,
    bins: [],
}

describe('exposureVerdict', () => {
    it('calls the dark session frame too dark and brightens it', () => {
        const result = exposureVerdict(DARK_ROOM_WITH_LAMP)
        expect(result.verdict).toBe('too dark')
        expect(result.suggestedStops).toBeGreaterThan(0)
    })

    it('limits brightening to the highlight headroom', () => {
        const roomy = exposureVerdict({ ...DARK_ROOM_WITH_LAMP, highlightHeadroomStops: 3 })
        expect(roomy.suggestedStops).toBe(2)
    })

    it('darkens when highlights clip', () => {
        const result = exposureVerdict({
            ...DARK_ROOM_WITH_LAMP,
            meanPercent: 50,
            crushedShadowsPercent: 0,
            clippedHighlightsPercent: 4,
        })
        expect(result.verdict).toBe('too bright')
        expect(result.suggestedStops).toBeLessThan(0)
    })

    it('leaves a balanced frame alone', () => {
        const result = exposureVerdict({ ...DARK_ROOM_WITH_LAMP, meanPercent: 45, crushedShadowsPercent: 1 })
        expect(result).toEqual({ verdict: 'good', suggestedStops: 0 })
    })
})
