import type { LogEntry } from '@shared/ipc'
import { useEffect, useRef } from 'react'

interface EventLogProps {
    logs: LogEntry[]
}

function formatTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleTimeString(undefined, { hour12: false })
}

export function EventLog({ logs }: EventLogProps): React.JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const element = scrollRef.current
        if (element) element.scrollTop = element.scrollHeight
    }, [logs])

    return (
        <div className="panel eventlog-panel">
            <div className="panel-header">
                <h2>Events</h2>
                <span className="eventlog-count">{logs.length}</span>
            </div>
            <div className="eventlog" ref={scrollRef}>
                {logs.length === 0 && <div className="eventlog-empty">Camera and voice events will appear here</div>}
                {logs.map((entry, index) => (
                    <div key={index} className={`eventlog-entry eventlog-${entry.level}`}>
                        <span className="eventlog-time">{formatTime(entry.timestampMs)}</span>
                        <span className={`eventlog-source eventlog-source-${entry.source}`}>{entry.source}</span>
                        <span className="eventlog-message">{entry.message}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}
