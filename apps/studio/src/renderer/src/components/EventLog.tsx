import { Button } from '@kevinschaich/components'
import type { LogEntry } from '@shared/ipc'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface EventLogProps {
    logs: LogEntry[]
    expanded: boolean
    onToggle: () => void
    /** Shown at the right end of the bar (live view stats). */
    trailing?: React.ReactNode
}

/** Paths read better relative to the home folder, as Finder shows them. */
function shortenPaths(message: string): string {
    return message.replace(/\/Users\/[^/\s]+/g, '~')
}

function formatTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleTimeString(undefined, { hour12: false })
}

const SOURCE_COLORS: Record<LogEntry['source'], string> = {
    camera: 'text-sky-400',
    system: 'text-muted-foreground',
    voice: 'text-violet-400',
}

export function EventLog({ logs, expanded, onToggle, trailing }: EventLogProps): React.JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null)
    const latest = logs.at(-1)
    const errorCount = logs.filter(entry => entry.level === 'error').length

    useEffect(() => {
        const element = scrollRef.current
        if (element) element.scrollTop = element.scrollHeight
    }, [logs, expanded])

    return (
        <div className="flex shrink-0 flex-col bg-black/55">
            <div className="flex h-8 items-center gap-3 px-3 text-xs">
                <Button variant="ghost" size="xs" onClick={onToggle} aria-expanded={expanded} aria-controls="event-log">
                    {expanded ? <ChevronDown /> : <ChevronUp />} Activity
                    <span className="text-muted-foreground tabular-nums">{logs.length}</span>
                    {errorCount > 0 && (
                        <span className="text-destructive tabular-nums">
                            · {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                        </span>
                    )}
                </Button>
                {!expanded && latest ? (
                    <span
                        className={`min-w-0 flex-1 truncate ${latest.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                        {shortenPaths(latest.message)}
                    </span>
                ) : (
                    <span className="flex-1" />
                )}
                {trailing}
            </div>
            {expanded && (
                <div
                    id="event-log"
                    ref={scrollRef}
                    className="selectable h-44 overflow-y-auto px-3 pb-2 font-mono text-xs leading-5"
                    role="log"
                    aria-live="polite"
                >
                    {logs.length === 0 && (
                        <p className="text-muted-foreground">Camera and voice activity shows up here.</p>
                    )}
                    {logs.map((entry, index) => (
                        <div key={index} className="flex gap-3">
                            <span className="shrink-0 text-muted-foreground/60 tabular-nums">
                                {formatTime(entry.timestampMs)}
                            </span>
                            <span className={`w-12 shrink-0 ${SOURCE_COLORS[entry.source]}`}>{entry.source}</span>
                            <span className={entry.level === 'error' ? 'text-destructive' : ''}>
                                {shortenPaths(entry.message)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
