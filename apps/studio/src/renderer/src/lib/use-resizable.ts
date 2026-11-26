import { useCallback, useState } from 'react'
import { persisted } from '@renderer/lib/persisted'

/**
 * The pane's edge that drags: a right sidebar's left edge widens it leftward, a left sidebar's right edge widens it
 * rightward, and a bottom panel's top edge heightens it upward.
 */
export type ResizeEdge = 'left' | 'right' | 'top'

const storedSize = (key: string, fallback: number) =>
    persisted<number>(key, text => {
        const value = Number(text)
        return Number.isFinite(value) && value > 0 ? value : undefined
    }, fallback)

/**
 * A pane's size that its edge drags, as old Outpost's panes do: it follows the pointer between min and max, is
 * remembered per window in localStorage, and steps with the arrow keys. `dragging` holds off size transitions so
 * the pane tracks the pointer exactly.
 */
export function useResizable(key: string, initial: number, min: number, max: () => number, edge: ResizeEdge) {
    const [size, setSize] = useState(() => storedSize(key, initial).load())
    const [dragging, setDragging] = useState(false)
    const clamp = useCallback(
        (value: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max()))),
        [min, max]
    )
    const save = useCallback(
        (value: number) => storedSize(key, value).save(value),
        [key]
    )

    const startDrag = (event: React.PointerEvent): void => {
        event.preventDefault()
        const horizontal = edge !== 'top'
        const start = horizontal ? event.clientX : event.clientY
        const from = size
        let latest = from
        setDragging(true)
        // The resize cursor stays while the pointer is anywhere in the window, not just over the strip.
        document.documentElement.style.cursor = horizontal ? 'col-resize' : 'row-resize'
        const move = (moved: PointerEvent): void => {
            const now = horizontal ? moved.clientX : moved.clientY
            latest = clamp(from + (edge === 'right' ? now - start : start - now))
            setSize(latest)
        }
        const end = (): void => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', end)
            window.removeEventListener('pointercancel', end)
            document.documentElement.style.cursor = ''
            setDragging(false)
            save(latest)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', end)
        window.addEventListener('pointercancel', end)
    }

    const onKeyDown = (event: React.KeyboardEvent): void => {
        const grow = { left: ['ArrowLeft'], right: ['ArrowRight'], top: ['ArrowUp'] }[edge]
        const shrink = { left: ['ArrowRight'], right: ['ArrowLeft'], top: ['ArrowDown'] }[edge]
        const step = event.shiftKey ? 48 : 16
        let next: number | null = null
        if (grow.includes(event.key)) next = clamp(size + step)
        if (shrink.includes(event.key)) next = clamp(size - step)
        if (next === null) return
        event.preventDefault()
        setSize(next)
        save(next)
    }

    return { size: clamp(size), dragging, startDrag, onKeyDown }
}
