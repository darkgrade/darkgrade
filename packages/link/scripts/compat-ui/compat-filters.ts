/**
 * Table filters and sorting, read from and written to the URL query string so every view can be
 * bookmarked and shared. Shared by the server, the static export, the browser and the suite (which
 * uses the same filter to run a subset).
 *
 *   ?manufacturer=canon&line=eos-r&fidelity=captured,hardware&transport=ptp-ip
 *   &set-property=fail&unverified=yes&q=r6&sort=model&order=desc
 */
import { CELL_STATUSES, type CellStatus, type ViewRow } from './compat-view'

export const FIDELITIES = ['hardware', 'captured', 'documented'] as const
export const TRANSPORTS = ['usb', 'ptp-ip'] as const
export const KINDS = ['model', 'line', 'profile'] as const
const FIXED_KEYS = [
    'profile',
    'manufacturer',
    'line',
    'fidelity',
    'transport',
    'kind',
    'unverified',
    'q',
    'sort',
    'order',
    'run',
]

export interface CompatFilters {
    /** Exact profile ids. */
    profile: string[]
    manufacturer?: string
    line?: string
    fidelity: string[]
    transport: string[]
    /** "model": per-model mocks; "line": one mock per line; "profile": captured profiles and hardware rows. */
    kind: string[]
    unverified?: 'yes' | 'no'
    /** Capability id -> statuses to keep. */
    status: Record<string, CellStatus[]>
    q?: string
    sort?: string
    order: 'asc' | 'desc'
    /** Show a single past run instead of the latest results. */
    run?: string
}

function list(value: string | null, allowed: readonly string[]): string[] {
    if (!value) return []
    return value
        .split(',')
        .map(item => item.trim())
        .filter(item => allowed.includes(item))
}

export function parseFilters(search: string | URLSearchParams, capabilityIds: string[]): CompatFilters {
    const parameters = typeof search === 'string' ? new URLSearchParams(search) : search
    const status: Record<string, CellStatus[]> = {}
    for (const capability of capabilityIds) {
        const statuses = list(parameters.get(capability), CELL_STATUSES) as CellStatus[]
        if (statuses.length) status[capability] = statuses
    }
    const unverified = parameters.get('unverified')
    const order = parameters.get('order')
    return {
        profile: (parameters.get('profile') ?? '')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean),
        ...(parameters.get('manufacturer') && { manufacturer: parameters.get('manufacturer')! }),
        ...(parameters.get('line') && { line: parameters.get('line')! }),
        fidelity: list(parameters.get('fidelity'), FIDELITIES),
        transport: list(parameters.get('transport'), TRANSPORTS),
        kind: list(parameters.get('kind'), KINDS),
        ...((unverified === 'yes' || unverified === 'no') && { unverified }),
        status,
        ...(parameters.get('q')?.trim() && { q: parameters.get('q')!.trim() }),
        ...(parameters.get('sort') && { sort: parameters.get('sort')! }),
        order: order === 'desc' ? 'desc' : 'asc',
        ...(parameters.get('run') && { run: parameters.get('run')! }),
    }
}

/** The query string for a filter set, in a stable key order; route segments are left out by the caller. */
export function serializeFilters(filters: CompatFilters, omit: string[] = []): string {
    const parameters = new URLSearchParams()
    const add = (key: string, value: string | undefined) => {
        if (value && !omit.includes(key)) parameters.set(key, value)
    }
    add('profile', filters.profile.join(','))
    add('manufacturer', filters.manufacturer)
    add('line', filters.line)
    add('fidelity', filters.fidelity.join(','))
    add('transport', filters.transport.join(','))
    add('kind', filters.kind.join(','))
    add('unverified', filters.unverified)
    for (const [capability, statuses] of Object.entries(filters.status)) add(capability, statuses.join(','))
    add('q', filters.q)
    add('sort', filters.sort)
    if (filters.sort) add('order', filters.order === 'desc' ? 'desc' : undefined)
    add('run', filters.run)
    return parameters.toString()
}

export function isReservedKey(key: string): boolean {
    return FIXED_KEYS.includes(key)
}

export function rowKind(row: Pick<ViewRow, 'scope'>): 'model' | 'line' | 'profile' {
    return row.scope ?? 'profile'
}

function matchesText(row: ViewRow, query: string): boolean {
    const haystack = `${row.manufacturer} ${row.line} ${row.model} ${row.profile} ${row.usb.join(' ')}`.toLowerCase()
    return query
        .toLowerCase()
        .split(/\s+/)
        .every(term => haystack.includes(term))
}

export function matchesFilters(row: ViewRow, filters: CompatFilters): boolean {
    if (filters.profile.length && !filters.profile.includes(row.profile)) return false
    if (filters.manufacturer && row.manufacturerSlug !== filters.manufacturer) return false
    if (filters.line && row.lineSlug !== filters.line) return false
    if (filters.fidelity.length && !filters.fidelity.includes(row.fidelity)) return false
    if (filters.transport.length && !filters.transport.includes(row.transport)) return false
    if (filters.kind.length && !filters.kind.includes(rowKind(row))) return false
    if (filters.unverified === 'yes' && !row.unverified) return false
    if (filters.unverified === 'no' && row.unverified) return false
    for (const [capability, statuses] of Object.entries(filters.status)) {
        if (!statuses.includes(row.cells[capability]?.status ?? 'no-data')) return false
    }
    return !filters.q || matchesText(row, filters.q)
}

const FIDELITY_ORDER: Record<string, number> = { hardware: 0, captured: 1, documented: 2 }
const STATUS_ORDER: Record<string, number> = { fail: 0, running: 1, queued: 2, pass: 3, unsupported: 4, 'no-data': 5 }

function compareText(left: string | undefined, right: string | undefined): number {
    return (left ?? '').localeCompare(right ?? '', undefined, { numeric: true })
}

/** Default order: fidelity (hardware first), then manufacturer, line and model. */
export function compareRows(sort: string | undefined, order: 'asc' | 'desc') {
    const direction = order === 'desc' ? -1 : 1
    return (left: ViewRow, right: ViewRow): number => {
        let result = 0
        if (sort === 'manufacturer') result = compareText(left.manufacturer, right.manufacturer)
        else if (sort === 'line') result = compareText(left.line, right.line)
        else if (sort === 'model') result = compareText(left.model, right.model)
        else if (sort === 'fidelity') result = FIDELITY_ORDER[left.fidelity] - FIDELITY_ORDER[right.fidelity]
        else if (sort === 'transport') result = compareText(left.transport, right.transport)
        else if (sort === 'last-run') result = compareText(left.lastRun, right.lastRun)
        else if (sort === 'unverified') result = Number(right.unverified) - Number(left.unverified)
        else if (sort) {
            const status = (row: ViewRow) => STATUS_ORDER[row.cells[sort]?.status ?? 'no-data'] ?? 9
            result = status(left) - status(right)
        }
        if (result !== 0) return result * direction
        return (
            FIDELITY_ORDER[left.fidelity] - FIDELITY_ORDER[right.fidelity] ||
            compareText(left.manufacturer, right.manufacturer) ||
            compareText(left.line, right.line) ||
            compareText(left.model, right.model) ||
            compareText(left.transport, right.transport)
        )
    }
}

export function applyFilters(rows: ViewRow[], filters: CompatFilters): ViewRow[] {
    return rows.filter(row => matchesFilters(row, filters)).sort(compareRows(filters.sort, filters.order))
}
