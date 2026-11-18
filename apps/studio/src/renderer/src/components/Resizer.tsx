import type { ResizeEdge } from '@renderer/lib/use-resizable'

interface ResizerProps {
    edge: ResizeEdge
    label: string
    size: number
    min: number
    max: number
    dragging: boolean
    onPointerDown: (event: React.PointerEvent) => void
    onKeyDown: (event: React.KeyboardEvent) => void
}

/**
 * The strip over a pane's hairline edge that drags it, as old Outpost's Resizer: 8px to grab, invisible until
 * hovered, then the hairline lights gold while it's held. Focusable, and the arrow keys move it too.
 */
export function Resizer({
    edge,
    label,
    size,
    min,
    max,
    dragging,
    onPointerDown,
    onKeyDown,
}: ResizerProps): React.JSX.Element {
    const vertical = edge !== 'top'
    return (
        <div
            role="separator"
            aria-label={label}
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            aria-valuenow={size}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            data-dragging={dragging || undefined}
            className={`resizer group absolute z-20 outline-none ${{ left: 'inset-y-0 -left-1 w-2 cursor-col-resize!', right: 'inset-y-0 -right-1 w-2 cursor-col-resize!', top: 'inset-x-0 -top-1 h-2 cursor-row-resize!' }[edge]}`}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
        >
            <span
                className={`absolute bg-gold/0 transition-colors duration-150 group-hover:bg-gold/40 group-focus-visible:bg-gold/60 group-data-[dragging]:bg-gold/70 ${vertical ? 'inset-y-0 left-[3.5px] w-px' : 'inset-x-0 top-[3.5px] h-px'}`}
                aria-hidden
            />
        </div>
    )
}
