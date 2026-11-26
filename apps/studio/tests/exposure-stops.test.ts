import {
    advertisedExposureValues,
    apertureToNumber,
    isAutoValue,
    isoToNumber,
    nearestNumericOption,
    shutterToNumber,
    shutterDialToNumber,
    stepValue,
} from '@shared/exposure-stops'
import { describe, expect, it } from 'vitest'

describe('advertised exposure dial values', () => {
    it('preserves vendor labels and never manufactures a fallback value', () => {
        expect(advertisedExposureValues(['ISO 800', 'Auto', 'ISO 125'], isoToNumber)).toEqual(['Auto', 'ISO 125', 'ISO 800'])
        expect(advertisedExposureValues(undefined, isoToNumber)).toEqual([])
        expect(advertisedExposureValues([], isoToNumber)).toEqual([])
        expect(advertisedExposureValues(['ISO 100', 'ISO 100'], isoToNumber)).toEqual([])
    })
    it('orders native angle values without treating them as durations', () => {
        expect(advertisedExposureValues(['90°', '360°', '180°'], shutterDialToNumber, true)).toEqual(['360°', '180°', '90°'])
        expect(shutterToNumber('180°')).toBeNull()
        expect(stepValue(['360°', '180°', '90°'], '180°', shutterDialToNumber, 1)).toBe('90°')
    })
})

const isoDial = ['Auto', 'ISO 100', 'ISO 200', 'ISO 400']

describe('stepValue over an advertised list', () => {
    it.each([
        ['steps one advertised entry', isoDial, 'ISO 200', isoToNumber, 1, 'ISO 400'],
        ['snaps an odd current value to the nearest entry first', isoDial, 'ISO 180', isoToNumber, 1, 'ISO 400'],
        ['refuses to step ISO auto', isoDial, 'Auto', isoToNumber, 1, null],
        ['clamps at the low edge without entering the special slot', isoDial, 'ISO 100', isoToNumber, -1, 'ISO 100'],
        ['clamps at the high edge', isoDial, 'ISO 400', isoToNumber, 1, 'ISO 400'],
        ['refuses to step bulb', ['BULB', '1/30', '1/60'], 'BULB', shutterToNumber, 1, null],
    ])('%s', (_name, values, current, toNumber, deltaIndices, expected) => {
        expect(stepValue(values, current, toNumber, deltaIndices)).toBe(expected)
    })
})

describe('switching an auto setting to manual', () => {
    it('recognises a setting the camera is choosing itself', () => {
        expect(isAutoValue('ISO AUTO', isoToNumber)).toBe(true)
        expect(isAutoValue('ISO 400', isoToNumber)).toBe(false)
        expect(isAutoValue(null, isoToNumber)).toBe(false)
    })

    it.each([
        ['ISO at base, skipping auto', ['ISO AUTO', 'ISO 100', 'ISO 125', 'ISO 200'], isoToNumber, 100, 'ISO 100'],
        ['ISO nearest base', ['ISO AUTO', 'ISO 160', 'ISO 200'], isoToNumber, 100, 'ISO 160'],
        ['a normal shutter', ['BULB', '1/30', '1/50', '1/125'], shutterToNumber, 1 / 60, '1/50'],
        ['a common aperture', ['f/2.8', 'f/4', 'f/8'], apertureToNumber, 4, 'f/4'],
        ['nothing when no option is numeric', ['ISO AUTO'], isoToNumber, 100, null],
    ])('starts at %s', (_name, options, toNumber, target, expected) => {
        expect(nearestNumericOption(options, toNumber, target)).toBe(expected)
    })
})
