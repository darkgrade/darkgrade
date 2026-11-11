import { resolveFollowUp } from '@main/assistant/follow-ups'
import type { FoundRequest } from '@main/assistant/intent-schema'
import { describe, expect, it } from 'vitest'

const brighter: FoundRequest = { action: 'adjust_exposure', stops: 0.33 }
const warmer: FoundRequest = { action: 'adjust_color_temperature', kelvin: 250 }
const peakingOn: FoundRequest = { action: 'set_studio_view', focusPeaking: true }

describe('follow-ups resolve against what was just done', () => {
    it('repeats the last change, whatever kind it was', () => {
        expect(resolveFollowUp('Little more.', [brighter, warmer])).toEqual(warmer)
        expect(resolveFollowUp('Bit more.', [warmer, brighter])).toEqual(brighter)
        expect(resolveFollowUp('Again.', [warmer])).toEqual(warmer)
    })

    it('reverses the last change', () => {
        expect(resolveFollowUp('Too far, pull it back.', [brighter])).toEqual({ ...brighter, stops: -0.33 })
        expect(resolveFollowUp('Actually that’s too far. Back a little.'.split('. ')[1], [warmer])).toEqual({ ...warmer, kelvin: -250 })
    })

    it('reverses only when the named direction matches the last step', () => {
        expect(resolveFollowUp('This is too warm, back a bit.', [warmer])).toEqual({ ...warmer, kelvin: -250 })
        expect(resolveFollowUp('Too warm.', [brighter])).toBeNull()
        expect(resolveFollowUp('Too bright.', [{ ...brighter, stops: -0.33 }])).toBeNull()
    })

    it('turns off what was just turned on, and undoes', () => {
        expect(resolveFollowUp('Okay, turn it off.', [peakingOn])).toEqual({ action: 'set_studio_view', focusPeaking: false })
        expect(resolveFollowUp('No, undo that.', [brighter])).toEqual({ action: 'undo_last_change' })
    })

    it('leaves anything else to the model', () => {
        expect(resolveFollowUp('Take a still for the thumbnail.', [warmer])).toBeNull()
        expect(resolveFollowUp('Little more.', [])).toBeNull()
        expect(resolveFollowUp('I want a little more blur in the background.', [brighter])).toBeNull()
    })
})
