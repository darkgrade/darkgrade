import {
    APERTURE_VALUES,
    apertureToNumber,
    isAutoValue,
    ISO_VALUES,
    isoToNumber,
    nearestNumericOption,
    SHUTTER_VALUES,
    shutterToNumber,
    stepValue,
} from '@shared/exposure-stops'
import { describe, expect, it } from 'vitest'

describe('stepValue', () => {
    it('steps ISO one full stop up (+3 thirds)', () => {
        expect(stepValue(ISO_VALUES, '800', isoToNumber, 3)).toBe('1600')
    })
    it('steps ISO one full stop down', () => {
        expect(stepValue(ISO_VALUES, '800', isoToNumber, -3)).toBe('400')
    })
    it('snaps odd current values to the nearest stop first', () => {
        expect(stepValue(ISO_VALUES, '750', isoToNumber, 3)).toBe('1600')
    })
    it('refuses to step ISO auto', () => {
        expect(stepValue(ISO_VALUES, 'auto', isoToNumber, 3)).toBeNull()
    })
    it('clamps at table edges without entering the special slot', () => {
        expect(stepValue(ISO_VALUES, '50', isoToNumber, -3)).toBe('50')
        expect(stepValue(ISO_VALUES, '102400', isoToNumber, 3)).toBe('102400')
    })
    it('steps shutter toward faster (darker) with positive index delta', () => {
        expect(stepValue(SHUTTER_VALUES, '1/60', shutterToNumber, 3)).toBe('1/125')
        expect(stepValue(SHUTTER_VALUES, '1/60', shutterToNumber, -3)).toBe('1/30')
    })
    it('refuses to step bulb', () => {
        expect(stepValue(SHUTTER_VALUES, 'bulb', shutterToNumber, 3)).toBeNull()
    })
    it('steps aperture a full stop', () => {
        expect(stepValue(APERTURE_VALUES, 'f/2.8', apertureToNumber, 3)).toBe('f/4')
        expect(stepValue(APERTURE_VALUES, 'f/2.8', apertureToNumber, -3)).toBe('f/2')
    })
})

describe('switching an auto setting to manual', () => {
    it('recognises a setting the camera is choosing itself', () => {
        expect(isAutoValue('ISO AUTO', isoToNumber)).toBe(true)
        expect(isAutoValue('ISO 400', isoToNumber)).toBe(false)
        expect(isAutoValue(null, isoToNumber)).toBe(false)
    })

    it('starts ISO at the option nearest base ISO, skipping auto', () => {
        expect(nearestNumericOption(['ISO AUTO', 'ISO 100', 'ISO 125', 'ISO 200'], isoToNumber, 100)).toBe('ISO 100')
        expect(nearestNumericOption(['ISO AUTO', 'ISO 160', 'ISO 200'], isoToNumber, 100)).toBe('ISO 160')
    })

    it('finds a normal shutter and a common aperture', () => {
        expect(nearestNumericOption(['BULB', '1/30', '1/50', '1/125'], shutterToNumber, 1 / 60)).toBe('1/50')
        expect(nearestNumericOption(['f/2.8', 'f/4', 'f/8'], apertureToNumber, 4)).toBe('f/4')
    })

    it('gives nothing when no option is numeric', () => {
        expect(nearestNumericOption(['ISO AUTO'], isoToNumber, 100)).toBeNull()
    })
})
