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
