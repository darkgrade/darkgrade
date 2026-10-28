/** Naming rules for catalog entries. No Node imports, so the compatibility UI's pages can use them too. */
import type { CatalogLine, CatalogManufacturer } from './camera-catalog'

/** A URL- and file-safe name: lowercase ASCII words joined by hyphens. */
export function slug(text: string): string {
    return text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
}

/**
 * The line name without its parenthetical description, e.g. "EOS R" for "EOS R (mirrorless, RF
 * mount)". When two lines of a manufacturer share that base name, the description's lead-in is kept.
 */
export function shortLineName(manufacturer: CatalogManufacturer, line: CatalogLine): string {
    const base = (name: string) => name.split(' (')[0]
    const shared = manufacturer.lines.filter(other => base(other.name) === base(line.name)).length > 1
    if (!shared) return base(line.name)
    const description = line.name.slice(base(line.name).length + 2).split(/[:)]/)[0]
    return `${base(line.name)} (${description})`
}
