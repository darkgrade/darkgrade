/**
 * The compatibility UI's icons: small SVG shapes drawn as CSS masks in the current text colour, so
 * one class per icon works in light and dark themes and a table of thousands of cells stays light.
 * Every icon is rendered with a tooltip and an accessible label, so the text it replaces is not lost.
 * No Node or DOM dependencies; the server, static export and browser share it.
 */
import type { CellStatus, ViewFidelity } from './compat-view'

function stroke(width = 1.8): string {
    return `fill='none' stroke='black' stroke-width='${width}' stroke-linecap='round' stroke-linejoin='round'`
}

const STROKE = stroke()
const BOLD = stroke(2.2)
const THIN = stroke(1.4)

/** 16x16 SVG bodies. Strokes use the shared stroke styles; solid marks set their own fill. */
const SHAPES: Record<string, string> = {
    pass: `<path ${BOLD} d='M3 8.6l3.2 3.1L13 4.6'/>`,
    fail: `<path ${BOLD} d='M4 4l8 8M12 4l-8 8'/>`,
    unsupported: `<circle ${STROKE} cx='8' cy='8' r='5.6'/><path ${STROKE} d='M4.1 11.9l7.8-7.8'/>`,
    'no-data': `<circle fill='black' cx='8' cy='8' r='1.7'/>`,
    running: `<path ${BOLD} d='M8 2.4a5.6 5.6 0 1 1-5.6 5.6'/>`,
    queued: `<circle ${THIN} cx='8' cy='8' r='3.4'/>`,
    unknown: `<path ${STROKE} d='M5.8 6a2.3 2.3 0 1 1 3.4 2c-.8.4-1.2.9-1.2 1.7'/><circle fill='black' cx='8' cy='12.6' r='1.1'/>`,
    hardware: `<path ${STROKE} d='M1.8 5.2h3l1.2-1.8h4l1.2 1.8h3v7.6H1.8z'/><circle ${STROKE} cx='8' cy='8.8' r='2.3'/>`,
    captured: `<path ${STROKE} d='M1.4 9h2.8l1.6-4.6 2.6 8 2.1-5.6 1.1 2.2h3'/>`,
    documented: `<path ${STROKE} d='M4 1.8h5l3 3v9.4H4z'/><path ${STROKE} d='M9 1.8v3h3M6 8.4h4M6 11h4'/>`,
    'documented-line': `<path ${STROKE} d='M6 1.6h4.6l2.8 2.8v7.4'/><path ${STROKE} d='M2.8 4.4h5l2.8 2.8v7.2H2.8z'/>`,
    usb: `<path ${STROKE} d='M5.4 1.8v3M10.6 1.8v3M3.6 4.8h8.8v2.8a4.4 4.4 0 0 1-8.8 0zM8 12v2.4'/>`,
    'ptp-ip': `<path ${STROKE} d='M1.6 6.2a9.2 9.2 0 0 1 12.8 0M3.9 8.8a5.8 5.8 0 0 1 8.2 0'/><circle fill='black' cx='8' cy='12.2' r='1.5'/>`,
    unverified: `<path ${STROKE} d='M8 2.2l6.4 11.4H1.6z'/><path ${STROKE} d='M8 6.6v3'/><circle fill='black' cx='8' cy='11.8' r='1'/>`,
    open: `<path ${STROKE} d='M9.4 2.4h4.2v4.2M13.6 2.4L7.6 8.4M12 9.6v4H2.4V4h4'/>`,
    close: `<path ${STROKE} d='M4 4l8 8M12 4l-8 8'/>`,
    help: `<circle ${STROKE} cx='8' cy='8' r='6.2'/><path ${STROKE} d='M6.3 6.4a1.8 1.8 0 1 1 2.6 1.6c-.6.3-.9.7-.9 1.3'/><circle fill='black' cx='8' cy='11.5' r='.9'/>`,
    play: `<path fill='black' d='M4.6 2.6v10.8l8.8-5.4z'/>`,
    filter: `<path ${STROKE} d='M2 3h12l-4.6 5.6v4.8l-2.8-1.4V8.6z'/>`,
    reset: `<path ${STROKE} d='M3 8a5 5 0 1 0 1.6-3.7M3 2.4v2.8h2.8'/>`,
}

export type IconName = keyof typeof SHAPES

function dataUri(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27')}`
}

/** CSS rules for every icon, appended to the stylesheet. */
export function iconStylesheet(): string {
    return Object.entries(SHAPES)
        .map(
            ([name, body]) =>
                `.i-${name}{--icon:url("${dataUri(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'>${body}</svg>`)}")}`
        )
        .join('\n')
}

function escapeText(text: string): string {
    return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

/**
 * An icon with its meaning as accessible name and tooltip. Pass an empty title when the surrounding
 * element already has a fuller tooltip.
 */
export function icon(name: string, label: string, extraClass = '', title: string = label): string {
    const known = name in SHAPES ? name : 'unknown'
    const tooltip = title ? ` title="${escapeText(title)}"` : ''
    return `<i class="i i-${known}${extraClass ? ` ${extraClass}` : ''}" role="img" aria-label="${escapeText(label)}"${tooltip}></i>`
}

/** An icon next to text that already says what it means (hidden from assistive technology). */
export function decorativeIcon(name: string): string {
    return `<i class="i i-${name in SHAPES ? name : 'unknown'}" aria-hidden="true"></i>`
}

export const STATUS_LABELS: Record<CellStatus, string> = {
    pass: 'pass',
    fail: 'fail',
    unsupported: 'unsupported',
    'no-data': 'no data',
    running: 'running',
    queued: 'queued',
    unknown: 'unknown status',
}

export const STATUS_MEANINGS: Record<CellStatus, string> = {
    pass: 'darkgrade did it',
    fail: 'darkgrade tried and the camera or darkgrade got it wrong',
    unsupported: 'the camera refused it, or darkgrade has no definition for it',
    'no-data': 'the profile holds no response for it; nothing is invented',
    running: 'being checked now',
    queued: 'waiting in the current run',
    unknown: 'the result file holds a status this version does not know',
}

/** A known display status, or "unknown" for anything else (an older or newer file format). */
export function knownStatus(status: unknown): CellStatus {
    return typeof status === 'string' && status in STATUS_LABELS ? (status as CellStatus) : 'unknown'
}

export function statusIcon(status: unknown, label?: string): string {
    const known = knownStatus(status)
    return icon(known, label ?? STATUS_LABELS[known], `s-${known}`)
}

export const FIDELITY_LABELS: Record<ViewFidelity, string> = {
    hardware: 'hardware: ran on a physical camera',
    captured: 'captured: replays traffic recorded from a real camera',
    documented: 'documented: built from libgphoto2 and vendor documentation, not hardware-verified',
    unknown: 'unknown tier',
}

export function knownFidelity(fidelity: unknown): ViewFidelity {
    return typeof fidelity === 'string' && fidelity in FIDELITY_LABELS ? (fidelity as ViewFidelity) : 'unknown'
}

/** Fidelity as an icon; documented mocks show one page per model and a stack for a whole line. */
export function fidelityIcon(row: { fidelity: unknown; scope?: unknown }): string {
    const fidelity = knownFidelity(row.fidelity)
    const scope = fidelity === 'documented' && (row.scope === 'line' || row.scope === 'model') ? row.scope : undefined
    const name = fidelity === 'documented' && scope === 'line' ? 'documented-line' : fidelity
    const label = `${FIDELITY_LABELS[fidelity]}${scope ? ` (${scope} mock)` : ''}`
    return icon(name, label, `f-${fidelity}`)
}

export const TRANSPORT_LABELS: Record<string, string> = { usb: 'USB', 'ptp-ip': 'PTP/IP (network)' }

export function transportIcon(transport: unknown): string {
    const known = transport === 'ptp-ip' ? 'ptp-ip' : 'usb'
    return icon(known, TRANSPORT_LABELS[known], 'link')
}

export function unverifiedIcon(row: { unverified: boolean; unverifiedQuirks: number }): string {
    if (!row.unverified) return ''
    const quirks = Number.isFinite(row.unverifiedQuirks) ? row.unverifiedQuirks : 0
    const label = quirks
        ? `unverified: ${quirks} quirk${quirks === 1 ? '' : 's'} marked unconfirmed by their source`
        : 'unverified: the catalog entry is marked unconfirmed by its source'
    return icon('unverified', label, 'warn')
}

const MANUFACTURER_CODES: Record<string, string> = {
    canon: 'CAN',
    nikon: 'NIK',
    sony: 'SNY',
    fujifilm: 'FUJ',
    panasonic: 'PAN',
    'om-system': 'OMS',
    olympus: 'OLY',
    pentax: 'PTX',
    ricoh: 'RIC',
    leica: 'LCA',
    sigma: 'SIG',
    gopro: 'GPR',
    hasselblad: 'HAS',
    kodak: 'KOD',
    casio: 'CAS',
}

/** A three-letter manufacturer code for dense tables, e.g. "SNY"; the full name goes in its tooltip. */
export function manufacturerCode(manufacturerSlug: string): string {
    const known = Object.entries(MANUFACTURER_CODES).find(([prefix]) => manufacturerSlug.startsWith(prefix))
    if (known) return known[1]
    return (manufacturerSlug.replace(/[^a-z0-9]/g, '').slice(0, 3) || '?').toUpperCase()
}

const CAPABILITY_SHORT: Record<string, string> = {
    session: 'Conn',
    'device-info': 'Info',
    'list-properties': 'Props',
    'get-property': 'Get',
    'set-property': 'Set',
    capture: 'Shot',
    'live-view': 'Live',
    events: 'Evts',
    'recorded-exchanges': 'Replay',
    'vendor-operations': 'Vendor',
}

/** A column heading of at most six characters; the full label goes in its tooltip. */
export function capabilityShortLabel(capability: { id: string; label: string }): string {
    return CAPABILITY_SHORT[capability.id] ?? capability.label.split(/[\s/]+/)[0].slice(0, 6)
}

/** "now", "12m", "5h", "3d", or the date for anything older than a month; "" without a time. */
export function formatAge(iso: string | undefined, now = Date.now()): string {
    const time = iso ? Date.parse(iso) : NaN
    if (!Number.isFinite(time)) return ''
    const minutes = Math.round((now - time) / 60_000)
    if (minutes < 1) return 'now'
    if (minutes < 60) return `${minutes}m`
    if (minutes < 24 * 60) return `${Math.round(minutes / 60)}h`
    if (minutes < 30 * 24 * 60) return `${Math.round(minutes / (24 * 60))}d`
    return new Date(time).toISOString().slice(0, 10)
}
