import { Button } from '@kevinschaich/components'
import { activityLog } from '@renderer/lib/activity-store'
import type { LogEntry } from '@shared/ipc'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useRef } from 'react'

interface EventLogProps {
    expanded: boolean
    onToggle: () => void
}

/** Paths read better relative to the home folder, as Finder shows them. */
function shortenPaths(message: string): string {
    return message.replace(/\/Users\/[^/\s]+/g, '~')
}

function formatTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleTimeString(undefined, { hour12: false })
}

/** Who said each line, in the palette's own lights: the camera gold, voice the live green, the app quiet ink. */
const SOURCE_COLORS: Record<LogEntry['source'], string> = {
    camera: 'text-gold/80',
    system: 'text-muted-foreground',
    voice: 'text-live/80',
}

/** Developer Mode's activity log, along the bottom of the main card: the latest line, opening to the whole log. */
export function EventLog({ expanded, onToggle }: EventLogProps): React.JSX.Element {
    const logs = activityLog.use()
    const scrollRef = useRef<HTMLDivElement>(null)
    const latest = logs.at(-1)
    const errorCount = logs.filter(entry => entry.level === 'error').length

    useEffect(() => {
        const element = scrollRef.current
        if (element) element.scrollTop = element.scrollHeight
    }, [logs, expanded])

    return (
        <div className="flex shrink-0 flex-col border-t border-border">
            <div className="relative flex h-8 items-center gap-3 px-3 text-xs">
                <Button
                    variant="ghost"
                    size="xs"
                    className="quiet-control"
                    onClick={onToggle}
                    aria-expanded={expanded}
                    aria-controls="event-log"
                >
                    {expanded ? <ChevronDown /> : <ChevronUp />} Activity
                    <span className="text-muted-foreground tabular-nums">{logs.length}</span>
                    {errorCount > 0 && (
                        <span className="text-destructive tabular-nums">
                            · {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                        </span>
                    )}
                </Button>
                {!expanded && latest && (
                    <span
                        className={`min-w-0 flex-1 truncate ${latest.level === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                        {shortenPaths(latest.message)}
                    </span>
                )}
            </div>
            {expanded && (
                <div
                    id="event-log"
                    ref={scrollRef}
                    className="selectable relative flex h-48 flex-col gap-1.75 overflow-y-auto px-3 pt-1 pb-2.5 text-xs leading-4 tabular-nums"
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
