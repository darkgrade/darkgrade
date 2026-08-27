import {
    APERTURE_VALUES,
    apertureToNumber,
    ISO_VALUES,
    isoToNumber,
    SHUTTER_VALUES,
    shutterToNumber,
    stepValue,
} from '@renderer/lib/exposure-stops'
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
