export interface ConsoleSearchEntry { id: string; title: string; group: string; description: string }
const synonyms = [
    ['iso', 'sensitivity', 'gain'], ['white balance', 'wb', 'color temperature', 'colour temperature'],
    ['autofocus', 'af', 'focusing'], ['wifi', 'wi fi', 'wireless', 'network', 'ssid', 'credentials'],
    ['bluetooth', 'ble', 'bond'], ['aperture', 'iris', 'f stop'], ['shutter', 'exposure time'],
    ['movie', 'video', 'recording', 'codec'], ['metering', 'light measurement'], ['zoom', 'tele', 'wide'],
]
const normalize = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
export function searchConsole(entries: ConsoleSearchEntry[], query: string): ConsoleSearchEntry[] {
    const terms = normalize(query).split(/\s+/).filter(Boolean)
    if (!terms.length) return []
    return entries.map(entry => {
        const title = normalize(entry.title)
        let haystack = normalize(`${entry.title} ${entry.group} ${entry.description}`)
        for (const aliases of synonyms) if (aliases.some(alias => (` ${title} `).includes(` ${normalize(alias)} `))) haystack += ` ${aliases.join(' ')}`
        if (!terms.every(term => haystack.includes(term))) return { entry, score: -1 }
        return { entry, score: terms.reduce((score, term) => score + (title === term ? 20 : title.includes(term) ? 8 : 1), 0) }
    }).filter(hit => hit.score >= 0).sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title)).slice(0, 12).map(hit => hit.entry)
}
