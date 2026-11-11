import { useSyncExternalStore } from 'react'

/**
 * A value that changes often (a word, or the microphone level 12 times a second), kept outside React
 * state so only the components that show it re-render, never the whole app.
 */
export function createStore<Value>(initial: Value) {
    const listeners = new Set<() => void>()
    let current = initial
    const subscribe = (listener: () => void): (() => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
    }
    return {
        get: () => current,
        set: (next: Value) => {
            current = next
            listeners.forEach(listener => listener())
        },
        use: (): Value => useSyncExternalStore(subscribe, () => current),
    }
}
