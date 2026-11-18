import { createStore } from '@renderer/lib/external-store'
import type { DownloadProgress, LogEntry } from '@shared/ipc'

/**
 * State that changes often but only matters to one part of the window, kept outside the app's own state so a new
 * log entry or download step re-renders that part alone.
 */
const MAX_LOG_ENTRIES = 500

/** The Activity log (Developer Mode). */
export const activityLog = createStore<LogEntry[]>([])

export function appendLog(entry: LogEntry): void {
    activityLog.set([...activityLog.get().slice(-(MAX_LOG_ENTRIES - 1)), entry])
}

/** The card download under way, or null; the Card panel shows it, and the app only asks whether one runs. */
export const downloadProgress = createStore<DownloadProgress | null>(null)
