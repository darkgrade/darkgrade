import type { VoiceEngineStatus } from '@shared/ipc'

/** Where a listening session is; the transcription hook's own state. */
export type ListeningState = 'off' | 'preparing' | 'listening' | 'stopping'

export interface PanelSwitchState {
    open: boolean
    listening: ListeningState
    /** Unknown until the engine first reports. */
    enginePhase: VoiceEngineStatus['phase'] | undefined
    /** A start was already tried since the panel last opened; a failed start isn't retried in a loop. */
    startedThisOpening: boolean
}

/**
 * The voice panel is the switch: open listens, closed stops. A start waits until the last session has fully
 * stopped (a panel reopened while it winds down starts once it's off) and until the engine says it's downloaded:
 * the one-time download waits for Set up voice. Closing stops a session, including one whose start finishes late.
 */
export function panelSwitchAction(state: PanelSwitchState): 'start' | 'stop' | null {
    if (!state.open) return state.listening === 'listening' ? 'stop' : null
    if (state.startedThisOpening || state.listening !== 'off') return null
    if (!state.enginePhase || state.enginePhase === 'not-downloaded') return null
    return 'start'
}
