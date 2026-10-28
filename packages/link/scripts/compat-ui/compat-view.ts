/**
 * The compatibility UI's view model: one row per evaluated profile (per tier and transport), built
 * from completed support matrices and overlaid with run progress logs. Pure functions only, so the
 * server, the static export and the browser share them.
 */
import type { PlannedRow, ProgressEvent, RunSource } from '@scripts/camera-profiles/compat-progress'
import { slug } from '@scripts/camera-profiles/catalog-names'
import {
    rowKey,
    type CapabilityStatus,
    type MatrixFidelity,
    type MatrixTransport,
    type SupportMatrix,
    type SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'

export type CellStatus = CapabilityStatus | 'running' | 'queued'
export const CELL_STATUSES: CellStatus[] = ['pass', 'fail', 'unsupported', 'no-data', 'running', 'queued']

export interface ViewCell {
    status: CellStatus
    detail?: string
    at?: string
    durationMilliseconds?: number
    runId?: string
}

export interface ViewRow {
    key: string
    profile: string
    path: string
    manufacturer: string
    manufacturerSlug: string
    line: string
    lineSlug: string
    catalogLine?: string
    model: string
    fidelity: MatrixFidelity
    scope?: 'line' | 'model'
    transport: MatrixTransport
    usb: string[]
    firmware?: string
    host?: string
    /** Quirks (or the catalog entry) that their own source marks unconfirmed. */
    unverified: boolean
    unverifiedQuirks: number
    cells: Record<string, ViewCell>
    lastRun?: string
    /** Where this row stands in the active run. */
    state: 'idle' | 'queued' | 'running' | 'done'
}

export interface RunSummary {
    runId: string
    source: RunSource
    startedAt: string
    endedAt?: string
    outcome?: 'completed' | 'failed' | 'stopped'
    filter?: string
    pid: number
    rows: number
    finishedRows: number
    cells: number
    finishedCells: number
    current?: { key: string; capability: string }
    counts: Record<CapabilityStatus, number>
}

export interface ViewSource {
    label: string
    path: string
    generatedAt: string
}

export interface CompatView {
    generatedAt: string
    capabilities: { id: string; label: string }[]
    rows: ViewRow[]
    sources: ViewSource[]
    /** The run in progress, if any. */
    activeRun?: RunSummary
    runs: RunSummary[]
}

/** Catalog facts the matrices do not carry, keyed by profile id. */
export interface RowAnnotations {
    unverifiedModel?: boolean
}

const DETAIL_LIMIT = 280

function shorten(detail: string): string {
    return detail.length > DETAIL_LIMIT ? `${detail.slice(0, DETAIL_LIMIT - 1)}…` : detail
}

export function emptyView(capabilities: { id: string; label: string }[] = []): CompatView {
    return { generatedAt: new Date().toISOString(), capabilities, rows: [], sources: [], runs: [] }
}

function rowIdentity(
    row: Pick<PlannedRow, 'key' | 'profile' | 'path' | 'manufacturer' | 'line' | 'catalogLine' | 'model' | 'fidelity'> &
        Partial<Pick<PlannedRow, 'scope' | 'transport' | 'usb'>>
) {
    return {
        key: row.key,
        profile: row.profile,
        path: row.path,
        manufacturer: row.manufacturer,
        manufacturerSlug: slug(row.manufacturer),
        line: row.line,
        lineSlug: slug(row.line),
        ...(row.catalogLine && { catalogLine: row.catalogLine }),
        model: row.model,
        fidelity: row.fidelity,
        ...(row.scope && { scope: row.scope }),
        transport: row.transport ?? 'usb',
        usb: row.usb ?? [],
    }
}

function viewRowFromMatrix(row: SupportMatrixRow, at: string, annotations?: RowAnnotations): ViewRow {
    const cells: Record<string, ViewCell> = {}
    for (const [capability, result] of Object.entries(row.results)) {
        cells[capability] = { status: result.status, detail: shorten(result.detail), at }
    }
    return {
        ...rowIdentity({ ...row, key: rowKey(row) }),
        ...(row.firmware && { firmware: row.firmware }),
        ...(row.host && { host: row.host }),
        unverified: row.quirks.unverified > 0 || !!annotations?.unverifiedModel,
        unverifiedQuirks: row.quirks.unverified,
        cells,
        lastRun: at,
        state: 'idle',
    }
}

/** Adds (or replaces) every row of a completed matrix, stamped with the matrix's time. */
export function applyMatrix(
    view: CompatView,
    matrix: SupportMatrix,
    source: ViewSource,
    annotations: Map<string, RowAnnotations> = new Map()
): void {
    if (!view.capabilities.length) view.capabilities = matrix.capabilities
    const index = new Map(view.rows.map((row, position) => [row.key, position]))
    for (const row of matrix.rows) {
        const viewRow = viewRowFromMatrix(row, matrix.generatedAt, annotations.get(row.profile))
        const position = index.get(viewRow.key)
        if (position === undefined) {
            index.set(viewRow.key, view.rows.push(viewRow) - 1)
            continue
        }
        const existing = view.rows[position]
        if ((existing.lastRun ?? '') <= matrix.generatedAt) view.rows[position] = viewRow
    }
    view.sources.push(source)
}

function emptyCounts(): Record<CapabilityStatus, number> {
    return { pass: 0, fail: 0, unsupported: 0, 'no-data': 0 }
}

/**
 * Overlays one run's progress events. While the run is alive, rows it has not reached show as queued
 * and the capability in flight as running; once it ends (or its process is gone) only the results it
 * produced remain. Returns the run's summary and the keys of rows it touched.
 */
export function applyRun(
    view: CompatView,
    events: ProgressEvent[],
    options: { alive: boolean; annotations?: Map<string, RowAnnotations> }
): { summary?: RunSummary; touched: Set<string> } {
    const touched = new Set<string>()
    const start = events.find(event => event.type === 'run-start')
    if (!start || start.type !== 'run-start') return { touched }
    if (!view.capabilities.length) view.capabilities = start.capabilities
    const end = events.find(event => event.type === 'run-end')
    const active = options.alive && !end
    const capabilityCount = start.capabilities.length

    const summary: RunSummary = {
        runId: start.runId,
        source: start.source,
        startedAt: start.at,
        ...(start.filter && { filter: start.filter }),
        pid: start.pid,
        rows: start.rows.length,
        finishedRows: 0,
        cells: start.rows.length * capabilityCount,
        finishedCells: 0,
        counts: emptyCounts(),
    }
    if (end && end.type === 'run-end') {
        summary.endedAt = end.at
        summary.outcome = end.outcome
    } else if (!options.alive) {
        summary.outcome = 'stopped'
    }

    const index = new Map(view.rows.map((row, position) => [row.key, position]))
    const rowFor = (planned: PlannedRow): ViewRow => {
        const position = index.get(planned.key)
        if (position !== undefined) return view.rows[position]
        const created: ViewRow = {
            ...rowIdentity(planned),
            unverified: !!options.annotations?.get(planned.profile)?.unverifiedModel,
            unverifiedQuirks: 0,
            cells: {},
            state: 'idle',
        }
        index.set(planned.key, view.rows.push(created) - 1)
        return created
    }
    const planned = new Map(start.rows.map(row => [row.key, row]))
    const rows = new Map<string, ViewRow>()
    for (const row of start.rows) {
        const viewRow = rowFor(row)
        rows.set(row.key, viewRow)
        if (active) {
            viewRow.state = 'queued'
            for (const capability of start.capabilities)
                viewRow.cells[capability.id] = { status: 'queued', runId: start.runId }
            touched.add(row.key)
        }
    }

    let current: { key: string; capability: string } | undefined
    for (const event of events) {
        if (event.type === 'capability-start') {
            current = { key: event.key, capability: event.capability }
            const row = rows.get(event.key)
            if (!row || !active) continue
            row.state = 'running'
            row.cells[event.capability] = { status: 'running', runId: start.runId, at: event.at }
            continue
        }
        if (event.type === 'capability') {
            const row = rows.get(event.key)
            if (!row) continue
            summary.finishedCells += 1
            summary.counts[event.status] += 1
            // A settled run never overrides newer results (for example a later matrix).
            if (!active && (row.cells[event.capability]?.at ?? '') > event.at) continue
            row.cells[event.capability] = {
                status: event.status,
                detail: shorten(event.detail),
                at: event.at,
                durationMilliseconds: event.durationMilliseconds,
                runId: start.runId,
            }
            if ((row.lastRun ?? '') < event.at) row.lastRun = event.at
            touched.add(event.key)
            continue
        }
        if (event.type === 'row-end') {
            const row = rows.get(event.key)
            if (!row) continue
            const plannedRow = planned.get(event.key)
            row.state = active ? 'done' : 'idle'
            row.unverifiedQuirks = event.row.quirks.unverified
            row.unverified = row.unverifiedQuirks > 0 || !!options.annotations?.get(row.profile)?.unverifiedModel
            if (event.row.firmware) row.firmware = event.row.firmware
            if (event.row.host) row.host = event.row.host
            if (plannedRow?.usb) row.usb = plannedRow.usb
            summary.finishedRows += 1
            touched.add(event.key)
        }
    }
    if (active) {
        summary.current = current
        view.activeRun = summary
    } else {
        // An ended or abandoned run leaves no queued or running cells behind.
        for (const row of rows.values()) {
            row.state = 'idle'
            for (const [capability, cell] of Object.entries(row.cells)) {
                if (cell.status === 'queued' || cell.status === 'running') delete row.cells[capability]
            }
        }
    }
    view.runs.push(summary)
    return { summary, touched }
}

/** Finished and total capability checks for one row in the active run. */
export function rowProgress(row: ViewRow, capabilityCount: number): { done: number; total: number } {
    const done = Object.values(row.cells).filter(cell => cell.status !== 'queued' && cell.status !== 'running').length
    return { done: Math.min(done, capabilityCount), total: capabilityCount }
}
