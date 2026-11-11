import { IPC_EVENTS, type StudioViewState } from '@shared/ipc'

type Broadcast = (channel: string, payload: unknown) => void

/** What Studio's window shows (scopes, zebras, peaking), as it last reported, and a way for tools to change it. */
class StudioView {
    private broadcast: Broadcast = () => {}
    private state: StudioViewState | null = null

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    report(state: StudioViewState): void {
        this.state = state
    }

    getState(): StudioViewState | null {
        return this.state
    }

    change(change: Partial<StudioViewState>): StudioViewState | null {
        this.broadcast(IPC_EVENTS.ViewChange, change)
        if (this.state) this.state = { ...this.state, ...change }
        return this.state
    }
}

export const studioView = new StudioView()
