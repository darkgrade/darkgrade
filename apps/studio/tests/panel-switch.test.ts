import { panelSwitchAction, type PanelSwitchState } from '@voice/panel-switch'
import { startsNewParagraph } from '@voice/transcript-store'
import { describe, expect, it } from 'vitest'

const state = (change: Partial<PanelSwitchState>): PanelSwitchState => ({
    open: true,
    listening: 'off',
    enginePhase: 'ready',
    startedThisOpening: false,
    ...change,
})

describe('the voice panel as the switch', () => {
    it('starts listening when opened, and stops when closed', () => {
        expect(panelSwitchAction(state({}))).toBe('start')
        expect(panelSwitchAction(state({ open: false, listening: 'listening' }))).toBe('stop')
    })

    it('reopened while the last session winds down, starts once it is off instead of staying stuck', () => {
        expect(panelSwitchAction(state({ listening: 'stopping' }))).toBeNull()
        expect(panelSwitchAction(state({ listening: 'off' }))).toBe('start')
    })

    it('waits for the engine and never starts the one-time download on its own', () => {
        expect(panelSwitchAction(state({ enginePhase: undefined }))).toBeNull()
        expect(panelSwitchAction(state({ enginePhase: 'not-downloaded' }))).toBeNull()
    })

    it('does not retry a start that failed while the panel stays open', () => {
        expect(panelSwitchAction(state({ startedThisOpening: true }))).toBeNull()
    })
})

describe('where an utterance lands', () => {
    it('starts a new line when speaking starts after a pause, or at a marked paragraph after a sentence', () => {
        expect(startsNewParagraph(['How you doing?'], true, false)).toBe(true)
        expect(startsNewParagraph(['How you'], true, false)).toBe(true)
        expect(startsNewParagraph(['How you doing?'], false, false)).toBe(false)
        expect(startsNewParagraph(['How you doing?'], false, true)).toBe(true)
        expect(startsNewParagraph(['How you'], false, true)).toBe(false)
        expect(startsNewParagraph([], true, true)).toBe(false)
    })
})
