/** Types and naming rules for camera-catalog/camera-lines.json. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CatalogModel {
    name: string
    usbVendorId?: string
    usbProductId?: string
    ptpSupported: boolean
    gphotoFlags?: string[]
    tetherSupportedBy: string[]
    source: string
    unverified?: boolean
    note?: string
}

export interface CatalogQuirk {
    id: string
    description: string
    simulatorBehaviour: string
    opcodes?: string[] | null
    sources: string[]
    unverified?: boolean
}

export interface CatalogLine {
    name: string
    protocolFamily: string
    models: CatalogModel[]
    quirks: CatalogQuirk[]
    note?: string
}

export interface CatalogManufacturer {
    name: string
    usbVendorId: string | null
    ptpVendorExtensionId: string | null
    lines: CatalogLine[]
}

export interface CameraCatalog {
    about: Record<string, string>
    manufacturers: CatalogManufacturer[]
    darkgradeGaps: Record<string, unknown>
}

export const catalogPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../camera-catalog/camera-lines.json'
)

export function loadCatalog(file = catalogPath): CameraCatalog {
    return JSON.parse(readFileSync(file, 'utf8')) as CameraCatalog
}

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

export function findCatalogLine(catalog: CameraCatalog, manufacturerName: string, lineName: string) {
    const manufacturer = catalog.manufacturers.find(candidate => candidate.name === manufacturerName)
    const line = manufacturer?.lines.find(candidate => candidate.name === lineName)
    if (!manufacturer || !line) throw new Error(`No catalog line "${lineName}" for ${manufacturerName}`)
    return { manufacturer, line }
}
