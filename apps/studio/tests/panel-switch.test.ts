import { panelSwitchAction, type PanelSwitchState } from '@voice/panel-switch'
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
