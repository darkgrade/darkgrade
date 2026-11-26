/** Shared by every download Studio reports: model files and camera media. */
export const MODEL_PROGRESS_INTERVAL_MS = 150

/**
 * Lets at most one progress report through per interval. A finished report (`done`) always passes,
 * so the last number shown is the real total.
 */
export function progressThrottle(intervalMilliseconds: number): (done?: boolean) => boolean {
    let lastReportMs = 0
    return (done = false) => {
        const now = Date.now()
        if (!done && now - lastReportMs < intervalMilliseconds) return false
        lastReportMs = now
        return true
    }
}
