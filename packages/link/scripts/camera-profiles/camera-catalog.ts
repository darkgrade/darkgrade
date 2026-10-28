/** Types and naming rules for camera-catalog/camera-lines.json. */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CatalogModel {
    name: string
    usbVendorId?: string
    usbProductId?: string
    /** "unknown" when no source documents PTP support either way. */
    ptpSupported: boolean | 'unknown'
    gphotoFlags?: string[]
    tetherSupportedBy: string[]
    source: string
    /** Citation for the USB IDs when it differs from `source` (for example usb.ids). */
    usbIdSource?: string
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
    /** What the cited sources show, for quirks checked after the catalog was first built. */
    verification?: string
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

export { shortLineName, slug } from './catalog-names'

export function findCatalogLine(catalog: CameraCatalog, manufacturerName: string, lineName: string) {
    const manufacturer = catalog.manufacturers.find(candidate => candidate.name === manufacturerName)
    const line = manufacturer?.lines.find(candidate => candidate.name === lineName)
    if (!manufacturer || !line) throw new Error(`No catalog line "${lineName}" for ${manufacturerName}`)
    return { manufacturer, line }
}
