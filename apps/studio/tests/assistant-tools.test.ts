import { analyseFrame } from '@shared/frame-analysis'
import { matchOption } from '@shared/setting-values'
import { locateQuote } from '@voice/intent-follower'
import { intentHasStarted } from '@main/assistant/intent-schema'
import type { CameraControlName } from '@shared/ipc'
import { describe, expect, it } from 'vitest'

describe('recognizing a streamed request', () => {
    it.each([
        ...['', ' ', '\n', 'n', 'no', 'non', 'none', 'none\n', ' none \n', 'NONE\r\n'].map(answer => [answer, false] as const),
        ...['1', '1 ', '1 photo\n', '2 set iso 800; ', '\n3 view waveform'].map(answer => [answer, true] as const),
    ])('treats %j as started: %s', (answer, started) => {
        expect(intentHasStarted(answer)).toBe(started)
    })
})

describe('matching spoken values to the camera’s own', () => {
    it.each<[CameraControlName, string, string[], string | null]>([
        ['aperture', 'f/8', ['F5.6', 'F7.1', 'F8.0', 'F9.0'], 'F8.0'],
        ['shutterSpeed', '1/50', ['1/40', '1/50', '1/60'], '1/50'],
        ['iso', '1600', ['AUTO', 'ISO 800', 'ISO 1600'], 'ISO 1600'],
        ['focusMode', 'manual', ['AF-S', 'AF-C', 'DMF', 'MF'], 'MF'],
        ['focusMode', 'continuous', ['AF-S', 'AF-C', 'MF'], 'AF-C'],
        ['aperture', 'f/22', ['F2.8', 'F4.0', 'F5.6'], null],
        ['iso', '1250', ['ISO 1000', 'ISO 1600'], null],
        ['shutterSpeed', '1/250', ['1/200', '1/320'], null],
        ['aperture', 'f/4.5', ['F4.0', 'F5.6'], null],
    ])('%s %j among %j matches %j, never the nearest unoffered value', (setting, spoken, options, expected) => {
        expect(matchOption(setting, spoken, options)).toBe(expected)
    })
})

describe('placing a heard request on its words', () => {
    it('finds the quote despite different punctuation and case, and null when the words are not there', () => {
        const segment = ' Hmm, I think it’s a little overexposed. Could we drop it by a bit? Anyway'
        const found = locateQuote(segment, "it's a little overexposed, could we drop it by a bit")
        expect(found && segment.slice(found.start, found.end)).toBe('it’s a little overexposed. Could we drop it by a bit')
        expect(locateQuote('set the aperture to f8', 'start recording')).toBeNull()
    })
})

describe('measuring a frame', () => {
    function flatFrame(level: number, width = 30, height = 20): Uint8Array {
        return new Uint8Array(width * height * 4).map((_, index) => (index % 4 === 3 ? 255 : level))
    }

    it('reports a white frame as clipped with no headroom and a mid-grey frame as neutral with room to brighten', () => {
        const white = analyseFrame(flatFrame(255), 30, 20)
        expect(white.histogram.clippedHighlightsPercent).toBe(100)
        expect(white.histogram.highlightHeadroomStops).toBe(0)
        const grey = analyseFrame(flatFrame(118), 30, 20)
        expect(grey.histogram.meanPercent).toBeCloseTo(46.3, 0)
        expect(grey.histogram.highlightHeadroomStops).toBeGreaterThan(2)
        expect(grey.vectorscope.warmthPercent).toBe(0)
    })
})
