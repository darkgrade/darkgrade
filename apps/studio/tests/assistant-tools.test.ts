import { analyseFrame } from '@shared/frame-analysis'
import { matchOption } from '@shared/setting-values'
import { locateQuote } from '@voice/intent-follower'
import { describe, expect, it } from 'vitest'

describe('matching spoken values to the camera’s own', () => {
    it('reads apertures, shutter speeds and ISO however they are said', () => {
        expect(matchOption('aperture', 'f/8', ['F5.6', 'F7.1', 'F8.0', 'F9.0'])).toBe('F8.0')
        expect(matchOption('shutterSpeed', '1/50', ['1/40', '1/50', '1/60'])).toBe('1/50')
        expect(matchOption('iso', '1600', ['AUTO', 'ISO 800', 'ISO 1600'])).toBe('ISO 1600')
    })

    it('maps everyday words onto camera abbreviations', () => {
        expect(matchOption('focusMode', 'manual', ['AF-S', 'AF-C', 'DMF', 'MF'])).toBe('MF')
        expect(matchOption('focusMode', 'continuous', ['AF-S', 'AF-C', 'MF'])).toBe('AF-C')
    })

    it('refuses values the camera does not offer rather than guessing far away', () => {
        expect(matchOption('aperture', 'f/22', ['F2.8', 'F4.0', 'F5.6'])).toBeNull()
    })
})

describe('placing a heard request on its words', () => {
    it('finds the quote despite different punctuation and case', () => {
        const segment = ' Hmm, I think it’s a little overexposed. Could we drop it by a bit? Anyway'
        const found = locateQuote(segment, "it's a little overexposed, could we drop it by a bit")
        expect(found && segment.slice(found.start, found.end)).toBe('it’s a little overexposed. Could we drop it by a bit')
    })

    it('returns null when the words are not there', () => {
        expect(locateQuote('set the aperture to f8', 'start recording')).toBeNull()
    })
})

describe('measuring a frame', () => {
    function flatFrame(level: number, width = 30, height = 20): Uint8Array {
        return new Uint8Array(width * height * 4).map((_, index) => (index % 4 === 3 ? 255 : level))
    }

    it('reports a white frame as clipped with no headroom', () => {
        const analysis = analyseFrame(flatFrame(255), 30, 20)
        expect(analysis.histogram.clippedHighlightsPercent).toBe(100)
        expect(analysis.histogram.highlightHeadroomStops).toBe(0)
    })

    it('reports a mid-grey frame as neutral with room to brighten', () => {
        const analysis = analyseFrame(flatFrame(118), 30, 20)
        expect(analysis.histogram.meanPercent).toBeCloseTo(46.3, 0)
        expect(analysis.histogram.highlightHeadroomStops).toBeGreaterThan(2)
        expect(analysis.vectorscope.warmthPercent).toBe(0)
    })
})
