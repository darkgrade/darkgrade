type DisplayValue = number | bigint | string | boolean | null | undefined | object | Uint8Array

const MAX_LINE_WIDTH = 100

export function safeStringify(value: DisplayValue): string {
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'object' && value !== null)
        return JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry))
    return JSON.stringify(value)
}

export function formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp)
    const hours24 = date.getHours()
    const pad = (value: number, length = 2) => value.toString().padStart(length, '0')
    return `${hours24 % 12 || 12}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)} ${hours24 >= 12 ? 'PM' : 'AM'}`
}

export function formatBytes(bytes: number, decimals: number = 2): string {
    if (bytes < 1000) return `${bytes} B`
    let scaled = bytes / 1000
    for (const unit of ['KB', 'MB']) {
        if (scaled < 1000) return `${scaled.toFixed(decimals)} ${unit}`
        scaled /= 1000
    }
    return `${scaled.toFixed(decimals)} GB`
}

function arrayItem(value: DisplayValue): string {
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'number') return `0x${value.toString(16)}`
    return safeStringify(value)
}

function arrayLines(values: DisplayValue[], indent: number, key = '', comma = ''): string[] {
    const baseIndent = '  '.repeat(indent)
    const prefix = baseIndent + key
    if (!values.length) return [prefix + '[]' + comma]
    const items = values.map(arrayItem)
    const oneLine = `${prefix}[${items.join(', ')}]${comma}`
    if (oneLine.length <= MAX_LINE_WIDTH) return [oneLine]

    const lines = [prefix + '[']
    const itemIndent = '  '.repeat(indent + 1)
    let currentLine = ''
    for (let index = 0; index < items.length; index++) {
        const item = items[index] + (index < items.length - 1 ? ', ' : '')
        const candidate = currentLine ? currentLine + ' ' + item : item
        if (currentLine && (itemIndent + candidate).length > MAX_LINE_WIDTH) {
            lines.push(itemIndent + currentLine)
            currentLine = item
        } else currentLine = candidate
    }
    if (currentLine) lines.push(itemIndent + currentLine)
    return [...lines, baseIndent + ']' + comma]
}

export function formatJSON(value: DisplayValue, indent = 0): string[] {
    const baseIndent = '  '.repeat(indent)
    if (value === null || value === undefined || typeof value !== 'object') return [baseIndent + safeStringify(value)]
    if (Array.isArray(value)) return arrayLines(value, indent)
    const entries = Object.entries(value)
    if (!entries.length) return [baseIndent + '{}']

    const lines = [baseIndent + '{']
    entries.forEach(([key, entry], index) => {
        const comma = index < entries.length - 1 ? ',' : ''
        const prefix = `${baseIndent}  "${key}": `
        if (entry instanceof Uint8Array && entry.length > 100)
            lines.push(`${prefix}<Uint8Array: ${entry.length} bytes>${comma}`)
        else if (Array.isArray(entry)) lines.push(...arrayLines(entry, indent + 1, `"${key}": `, comma))
        else if (entry && typeof entry === 'object') {
            const nested = formatJSON(entry, indent + 1)
            lines.push(prefix + nested[0].trim(), ...nested.slice(1))
            lines[lines.length - 1] += comma
        } else lines.push(prefix + arrayItem(entry) + comma)
    })
    return [...lines, baseIndent + '}']
}
