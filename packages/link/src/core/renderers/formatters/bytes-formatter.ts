export function formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes < 1000) {
        return `${bytes} B`
    }

    const kb = bytes / 1000
    if (kb < 1000) {
        return `${kb.toFixed(decimals)} KB`
    }

    const mb = kb / 1000
    if (mb < 1000) {
        return `${mb.toFixed(decimals)} MB`
    }

    const gb = mb / 1000
    return `${gb.toFixed(decimals)} GB`
}
