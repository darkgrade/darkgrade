/** Formatting both Studio processes share. */

/** An error's own message; anything else thrown, as text. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** Decimal sizes, as macOS and cameras count them: B, then KB and MB with one decimal. */
export function formatBytes(bytes: number): string {
    if (bytes < 1000) return `${bytes} B`
    if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1)} KB`
    return `${(bytes / (1000 * 1000)).toFixed(1)} MB`
}

/** Decimal megabytes with one decimal, for a transfer's running count. */
export function formatMegabytes(bytes: number): string {
    return `${(bytes / 1e6).toFixed(1)} MB`
}

/** Decimal gigabytes, as macOS and the camera both count them. */
export function formatGigabytes(bytes: number): string {
    const gigabytes = bytes / 1e9
    return `${gigabytes >= 100 ? Math.round(gigabytes) : gigabytes.toFixed(1)} GB`
}

/** Sizes in words a person recognises: whole megabytes below a gigabyte, one decimal above. */
export function formatDownloadSize(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
    return `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

/** A path relative to the home folder, as Finder shows it. */
export const shortenHomePath = (path: string): string => path.replace(/^\/Users\/[^/]+/, '~')

/** Every home-folder path in a message, shortened the same way. */
export const shortenHomePaths = (text: string): string => text.replace(/\/Users\/[^/\s]+/g, '~')

/** "24 mm", "70.5 mm". */
export function formatFocalLength(millimetres: number): string {
    return `${Number.isInteger(millimetres) ? millimetres : millimetres.toFixed(1)} mm`
}

/** PTP dates arrive as "YYYYMMDDThhmmss"; show them the way Finder would. */
export function formatCaptureDate(raw: string): string {
    const match = /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2})/.exec(raw)
    if (!match) return raw
    const [, year, month, day, hour, minute] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute))
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Seconds as a timecode-style clock: mm:ss, or h:mm:ss from an hour. */
export function formatElapsed(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    const pad = (value: number): string => String(value).padStart(2, '0')
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
