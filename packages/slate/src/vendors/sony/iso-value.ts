/** Sony CRSDK 2.02 IsoSensitivity: extension bits 28–31, mode 24–27, value 0–23. */
export function sonyIsoLabel(raw: number): string {
    const value = raw & 0xffffff, mode = (raw >>> 24) & 15, extension = raw >>> 28
    if (value === 0xffffff && mode === 0 && extension === 0) return 'ISO AUTO'
    const prefix = mode === 0 ? 'ISO' : mode === 1 ? 'Multi Frame NR ISO' : mode === 2 ? 'Multi Frame NR High ISO' : undefined
    if (!prefix) return `Unknown ISO mode: 0x${(raw >>> 0).toString(16).padStart(8, '0')}`
    const suffix = extension === 1 ? ' (extended)' : extension ? ` (extension 0x${extension.toString(16)})` : ''
    return `${prefix} ${value}${suffix}`
}
export function sonyIsoRaw(label: string): number {
    const text = String(label).trim()
    if (/^(?:iso\s*)?auto$/i.test(text)) return 0xffffff
    const match = text.match(/^(?:(Multi Frame NR(?: High)?)\s+)?(?:ISO\s+)?(\d+)(?:\s+\((extended|extension 0x[0-9a-f])\))?$/i)
    if (!match || Number(match[2]) >= 0xffffff) throw new Error('Choose a camera-advertised ISO sensitivity')
    const mode = match[1] ? /high/i.test(match[1]) ? 2 : 1 : 0
    const extension = match[3] ? match[3].toLowerCase() === 'extended' ? 1 : parseInt(match[3].slice(-1), 16) : 0
    return ((extension << 28) | (mode << 24) | Number(match[2])) >>> 0
}
