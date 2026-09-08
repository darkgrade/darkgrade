'use client'

/**
 * Which backdrop is showing. A module-level store rather than context: the
 * header and the effects layer are siblings under a server component, and this
 * avoids turning the whole tree into a client boundary to share one boolean.
 */
export type BgMode = 'silk' | 'contours'

let mode: BgMode = 'silk'
const listeners = new Set<(m: BgMode) => void>()

export const getBgMode = () => mode
/** The server has no opinion; keeping it 'silk' matches the first client render. */
export const getBgModeServer = (): BgMode => 'silk'

export function setBgMode(next: BgMode) {
    if (next === mode) return
    mode = next
    listeners.forEach(l => l(mode))
}

export function subscribeBgMode(listener: (m: BgMode) => void) {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}
