/**
 * The compatibility UI's view model: one row per evaluated profile (per tier and transport), built
 * from completed support matrices and overlaid with run progress logs. Pure functions only, so the
 * server, the static export and the browser share them.
 */
import { slug } from '@scripts/camera-profiles/catalog-names'
import type { PlannedRow, ProgressEvent, RunSource } from '@scripts/camera-profiles/compat-progress'
import { matrixValue, progressEventValue } from '@scripts/camera-profiles/compat-schema'
import type { CompatibilityCamera } from '@scripts/camera-profiles/compatibility-matrix'
import {
    rowKey,
    type CapabilityStatus,
    type MatrixFidelity,
    type MatrixTransport,
    type SupportMatrix,
    type SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'

/** "unknown": a result file holds a status this version does not recognise. */
export type CellStatus = CapabilityStatus | 'running' | 'queued' | 'unknown'
export const CELL_STATUSES: CellStatus[] = ['pass', 'fail', 'unsupported', 'no-data', 'running', 'queued', 'unknown']
const RESULT_STATUSES: string[] = ['pass', 'fail', 'unsupported', 'no-data']
export type ViewFidelity = MatrixFidelity | 'unknown'
export type StatusTotals = Record<CapabilityStatus | 'unknown', number>

/** A result's status for display; an unrecognised value becomes "unknown" and is named in the detail. */
export function viewResult(status: unknown, detail: unknown): { status: CellStatus; detail: string } {
    const text = typeof detail === 'string' ? detail : ''
    if (typeof status === 'string' && RESULT_STATUSES.includes(status)) {
        return { status: status as CapabilityStatus, detail: shorten(text) }
    }
    const raw = typeof status === 'string' ? status.slice(0, 40) : String(status)
    return { status: 'unknown', detail: shorten(`unrecognised status "${raw}"${text ? `: ${text}` : ''}`) }
}

export type CapabilityEvidence = CompatibilityCamera['resultEvidence'][string]
export type EvidenceSupportMatrixRow = SupportMatrixRow & {
    resultEvidence?: Record<string, CapabilityEvidence>
    viewKey?: string
}

export interface ViewCell {
    status: CellStatus
    detail?: string
    at?: string
    durationMilliseconds?: number
    runId?: string
    evidence?: CapabilityEvidence
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
    fidelity: ViewFidelity
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
    counts: StatusTotals
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

function shorten(detail: string | undefined): string {
    const text = detail ?? ''
    return text.length > DETAIL_LIMIT ? `${text.slice(0, DETAIL_LIMIT - 1)}…` : text
}

/** A URL segment for a name; names with no ASCII letters or digits still get one. */
export function nameSlug(name: string): string {
    return slug(name) || 'unknown'
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
        manufacturerSlug: nameSlug(row.manufacturer),
        line: row.line,
        lineSlug: nameSlug(row.line),
        ...(row.catalogLine && { catalogLine: row.catalogLine }),
        model: row.model,
        fidelity: row.fidelity,
        ...(row.scope && { scope: row.scope }),
        transport: row.transport ?? 'usb',
        usb: row.usb ?? [],
    }
}

/** A profile may have distinct firmware observations in one imported hardware matrix. */
export function viewRowKey(row: EvidenceSupportMatrixRow): string {
    return row.viewKey ?? (row.firmware ? `${rowKey(row)}/firmware/${encodeURIComponent(row.firmware)}` : rowKey(row))
}

function viewRowFromMatrix(
    row: EvidenceSupportMatrixRow,
    at: string,
    annotations?: RowAnnotations,
    revision?: string
): ViewRow {
    const cells: Record<string, ViewCell> = {}
    for (const [capability, result] of Object.entries(row.results ?? {})) {
        const evidence =
            row.resultEvidence === undefined &&
            Number.isFinite(Date.parse(at)) &&
            ['hardware', 'captured', 'documented'].includes(row.fidelity)
                ? {
                      fidelity: row.fidelity,
                      profile: row.profile,
                      generatedAt: at,
                      ...(row.firmware && { firmware: row.firmware }),
                      ...(row.host && { host: row.host }),
                      ...(revision && { revision }),
                  }
                : row.resultEvidence?.[capability]
        cells[capability] = {
            ...viewResult(result?.status, result?.detail),
            at: evidence?.generatedAt ?? at,
            ...(evidence && { evidence }),
        }
    }
    const unverifiedQuirks = row.quirks?.unverified ?? 0
    return {
        ...rowIdentity({ ...row, key: viewRowKey(row) }),
        ...(row.firmware && { firmware: row.firmware }),
        ...(row.host && { host: row.host }),
        unverified: unverifiedQuirks > 0 || !!annotations?.unverifiedModel,
        unverifiedQuirks,
        cells,
        lastRun: at,
        state: 'idle',
    }
}

/** Completed rows retain original observation time; rebuilding an aggregate cannot freshen a stale result. */
export function applyMatrix(
    view: CompatView,
    matrix: SupportMatrix,
    source: ViewSource,
    annotations: Map<string, RowAnnotations> = new Map()
): void {
    const checked = matrixValue(matrix)
    if (!checked) return
    if (!view.capabilities.length) view.capabilities = checked.capabilities
    const index = new Map(view.rows.map((row, position) => [row.key, position]))
    for (const row of checked.rows as EvidenceSupportMatrixRow[]) {
        const viewRow = viewRowFromMatrix(
            row,
            row.source?.generatedAt ?? checked.generatedAt,
            annotations.get(row.profile),
            row.source?.revision ?? checked.revision
        )
        const position = index.get(viewRow.key)
        if (position === undefined) {
            index.set(viewRow.key, view.rows.push(viewRow) - 1)
            continue
        }
        const existing = view.rows[position]
        if (!existing.lastRun || Date.parse(existing.lastRun) <= Date.parse(viewRow.lastRun ?? ''))
            view.rows[position] = viewRow
    }
    view.sources.push(source)
}

function emptyCounts(): StatusTotals {
    return { pass: 0, fail: 0, unsupported: 0, 'no-data': 0, unknown: 0 }
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
    const checked = events.flatMap(event => progressEventValue(event) ?? [])
    const start = checked.find(event => event.type === 'run-start')
    if (!start || start.type !== 'run-start') return { touched }
    // A log holds one run; lines from another run (a file appended to by mistake) are ignored.
    const own = checked.filter(event => event.runId === start.runId)
    const originalSources = new Map(
        own.flatMap(event =>
            event.type === 'row-end' && event.row.source ? [[event.key, event.row.source] as const] : []
        )
    )
    if (!view.capabilities.length) view.capabilities = start.capabilities
    const end = own.find(event => event.type === 'run-end')
    const active = options.alive && !end

    const summary: RunSummary = {
        runId: start.runId,
        source: start.source,
        startedAt: start.at,
        ...(start.filter && { filter: start.filter }),
        pid: start.pid,
        rows: start.rows.length,
        finishedRows: 0,
        cells: start.rows.length * start.capabilities.length,
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

    // Repeated results for one cell (a retried check, a duplicated line) count once, with the last status.
    const finished = new Map<string, CellStatus>()
    const finishedRows = new Set<string>()
    let current: { key: string; capability: string } | undefined
    for (const event of own) {
        if (event.type === 'capability-start') {
            const row = rows.get(event.key)
            // A start logged after its own result (out of order) does not reopen the cell.
            if (!row || finished.has(`${event.key}\u0000${event.capability}`)) continue
            current = { key: event.key, capability: event.capability }
            if (!active) continue
            row.state = 'running'
            row.cells[event.capability] = { status: 'running', runId: start.runId, at: event.at }
            continue
        }
        if (event.type === 'capability') {
            const row = rows.get(event.key)
            if (!row) continue
            const result = viewResult(event.status, event.detail)
            const originalSource = originalSources.get(event.key)
            const observedAt = originalSource?.generatedAt ?? event.at
            finished.set(`${event.key}\u0000${event.capability}`, result.status)
            if (current?.key === event.key && current.capability === event.capability) current = undefined
            // A settled run never overrides newer results (for example a later matrix).
            const previousTime = Date.parse(row.cells[event.capability]?.at ?? '')
            const observedTime = Date.parse(observedAt)
            if (
                !active &&
                Number.isFinite(previousTime) &&
                (!Number.isFinite(observedTime) || previousTime > observedTime)
            )
                continue
            row.cells[event.capability] = {
                ...result,
                at: observedAt,
                durationMilliseconds: event.durationMilliseconds,
                runId: start.runId,
                ...(row.fidelity !== 'unknown' &&
                    Number.isFinite(observedTime) && {
                        evidence: {
                            fidelity: row.fidelity,
                            profile: row.profile,
                            generatedAt: observedAt,
                            ...(originalSource?.revision && { revision: originalSource.revision }),
                        },
                    }),
            }
            if (Number.isFinite(observedTime) && (!row.lastRun || Date.parse(row.lastRun) < observedTime))
                row.lastRun = observedAt
            touched.add(event.key)
            continue
        }
        if (event.type === 'row-end') {
            const row = rows.get(event.key)
            if (!row) continue
            const plannedRow = planned.get(event.key)
            const observedTime = Date.parse(event.row.source?.generatedAt ?? event.at)
            if (
                !active &&
                row.lastRun &&
                Number.isFinite(Date.parse(row.lastRun)) &&
                (!Number.isFinite(observedTime) || Date.parse(row.lastRun) > observedTime)
            ) {
                finishedRows.add(event.key)
                continue
            }
            row.state = active ? 'done' : 'idle'
            row.unverifiedQuirks = event.row.quirks?.unverified ?? 0
            row.unverified = row.unverifiedQuirks > 0 || !!options.annotations?.get(row.profile)?.unverifiedModel
            if (event.row.firmware) row.firmware = event.row.firmware
            if (event.row.host) row.host = event.row.host
            if (plannedRow?.usb) row.usb = plannedRow.usb
            for (const cell of Object.values(row.cells)) {
                if (cell.runId !== start.runId || !cell.evidence) continue
                if (event.row.firmware) cell.evidence.firmware = event.row.firmware
                if (event.row.host) cell.evidence.host = event.row.host
            }
            finishedRows.add(event.key)
            touched.add(event.key)
        }
    }
    for (const status of finished.values()) {
        if (status !== 'queued' && status !== 'running') summary.counts[status] += 1
    }
    summary.finishedCells = finished.size
    summary.finishedRows = finishedRows.size
    summary.cells = Math.max(summary.cells, summary.finishedCells)
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
