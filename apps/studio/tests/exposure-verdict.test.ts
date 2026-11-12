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
    it('brightens the dark session frame fully, letting the small lamp clip', () => {
        const result = exposureVerdict(DARK_ROOM_WITH_LAMP)
        expect(result).toEqual({ verdict: 'too dark', suggestedStops: 2 })
    })

    it('limits brightening to the headroom when highlights are a real part of the picture', () => {
        const brightWindow = {
            ...DARK_ROOM_WITH_LAMP,
            zones: { shadowsPercent: 80, midtonesPercent: 10, highlightsPercent: 10 },
        }
        expect(exposureVerdict(brightWindow).suggestedStops).toBeCloseTo(1 / 3)
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
