import { Tooltip, TooltipContent, TooltipTrigger } from '@kevinschaich/components'

interface HoverTipProps {
    /** What the tip says, with an optional shortcut after it. */
    tip: React.ReactNode
    /** The element that shows the tip on hover (a button). */
    render: React.ReactElement
    side?: 'top' | 'bottom'
    children?: React.ReactNode
}

/**
 * A tip that appears 0.2 s after the pointer rests on a control, no click needed, styled as Studio's popovers are
 * (the camera's and the preview's): the popover's surface and hairline ring, 12px across, no arrow.
 */
export function HoverTip({ tip, render, side = 'top', children }: HoverTipProps): React.JSX.Element {
    return (
        <Tooltip>
            <TooltipTrigger delay={200} render={render}>
                {children}
            </TooltipTrigger>
            <TooltipContent
                side={side}
                sideOffset={8}
                className="gap-2 rounded-lg bg-popover px-3 py-2 text-[13px] text-popover-foreground shadow-md ring-1 ring-foreground/10 [&_[data-slot=kbd]]:bg-foreground/10 [&_[data-slot=kbd]]:text-muted-foreground [&>:last-child]:hidden"
            >
                {tip}
            </TooltipContent>
        </Tooltip>
    )
}
