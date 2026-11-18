import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@kevinschaich/components'
import { ChevronRight } from 'lucide-react'

interface InspectorSectionProps {
    title: string
    action?: React.ReactNode
    /** Collapsible sections start closed unless defaultOpen is set. */
    collapsible?: boolean
    defaultOpen?: boolean
    children: React.ReactNode
}

const SECTION_CLASS = 'flex flex-col border-b border-border px-3 py-2.5 last:border-b-0'
const TITLE_CLASS = 'text-[14px] font-semibold text-foreground'

/** One titled group in the inspector. Groups are separated by a faint hairline, not boxes. */
export function InspectorSection({
    title,
    action,
    collapsible = false,
    defaultOpen = false,
    children,
}: InspectorSectionProps): React.JSX.Element {
    if (!collapsible) {
        return (
            <section className={`${SECTION_CLASS} gap-2`}>
                <header className="flex min-h-6 items-center justify-between gap-2">
                    <h2 className={TITLE_CLASS}>{title}</h2>
                    {action}
                </header>
                {children}
            </section>
        )
    }
    return (
        <Collapsible defaultOpen={defaultOpen} render={<section className={SECTION_CLASS} />}>
            {/* The title sits on the content's left edge; its chevron shows only while the header is hovered or focused. */}
            <header className="flex min-h-6 items-center justify-between gap-2">
                <CollapsibleTrigger className="group flex flex-1 items-center gap-1.5 rounded-sm text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    <h2 className={TITLE_CLASS}>{title}</h2>
                    <ChevronRight
                        className="size-3.5 text-foreground/40 opacity-0 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[panel-open]:rotate-90"
                        aria-hidden
                    />
                </CollapsibleTrigger>
                {action}
            </header>
            <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                <div className="flex flex-col gap-2 pt-2">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    )
}
