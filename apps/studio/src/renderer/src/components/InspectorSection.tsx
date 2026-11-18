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

const SECTION_CLASS = 'flex flex-col border-b border-border px-4 py-3 last:border-b-0'
const TITLE_CLASS = 'slate-label'

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
            <section className={`${SECTION_CLASS} gap-3`}>
                <header className="flex min-h-7 items-center justify-between gap-2">
                    <h2 className={TITLE_CLASS}>{title}</h2>
                    {action}
                </header>
                {children}
            </section>
        )
    }
    return (
        <Collapsible defaultOpen={defaultOpen} render={<section className={SECTION_CLASS} />}>
            <header className="flex min-h-7 items-center justify-between gap-2">
                <CollapsibleTrigger className="group -ml-1 flex flex-1 items-center gap-1 rounded-sm px-1 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
                    <ChevronRight
                        className="size-3.5 text-foreground/40 transition-transform duration-200 group-data-[panel-open]:rotate-90"
                        aria-hidden
                    />
                    <h2 className={TITLE_CLASS}>{title}</h2>
                </CollapsibleTrigger>
                {action}
            </header>
            <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                <div className="flex flex-col gap-3 pt-3">{children}</div>
            </CollapsibleContent>
        </Collapsible>
    )
}
