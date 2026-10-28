/**
 * Loads what the compatibility UI shows: completed matrices under test-results/, run progress logs
 * under test-results/compat-runs/, any result files passed on the command line or imported in the UI,
 * and the profiles behind each row. Parsed files are cached by size and modification time, so the
 * server can re-read on every tick while a run is in progress.
 */
import { loadCatalog, type CameraCatalog } from '@scripts/camera-profiles/camera-catalog'
import {
    defaultRunsDirectory,
    packageDirectory,
    parseProgress,
    type ProgressEvent,
} from '@scripts/camera-profiles/compat-progress'
import { isRecord, matrixValue } from '@scripts/camera-profiles/compat-schema'
import type { CompatibilityMatrix } from '@scripts/camera-profiles/compatibility-matrix'
import { loadProfileIndex, usbIdentities, type IndexedProfile } from '@scripts/camera-profiles/profile-index'
import type {
    CapabilityResult,
    MatrixFidelity,
    MatrixTransport,
    SupportMatrix,
} from '@scripts/camera-profiles/support-matrix'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import { buildGapReport, type GapReport } from './compat-gaps'
import {
    applyMatrix,
    applyRun,
    emptyView,
    viewRowKey,
    type CapabilityEvidence,
    type CompatView,
    type EvidenceSupportMatrixRow,
    type RowAnnotations,
} from './compat-view'

/** A run log stops counting as in progress when it has not grown for this long. */
const STALE_RUN_MILLISECONDS = 10 * 60 * 1000

export const resultsDirectory = path.join(packageDirectory, 'test-results')

export interface RunFile {
    runId: string
    file: string
    modified: number
    size: number
}

export interface MatrixFile {
    /** Stable id for ?run=, e.g. "matrix:camera-support-matrix.json". */
    id: string
    label: string
    file: string
    /** Viewable on its own, but left out of the latest-results view (its rows come from other files). */
    standalone?: boolean
}

/** A merged compatibility matrix (compat:merge) as support-matrix rows, so it can be viewed like one. */
function latestEvidenceSource(evidence: Record<string, CapabilityEvidence> | undefined) {
    const latest = Object.values(evidence ?? {})
        .filter(source => typeof source?.generatedAt === 'string' && Number.isFinite(Date.parse(source.generatedAt)))
        .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))[0]
    return {
        generatedAt: latest?.generatedAt ?? '',
        ...(typeof latest?.revision === 'string' && { revision: latest.revision }),
    }
}

export function rowsFromCompatibility(matrix: CompatibilityMatrix): SupportMatrix {
    const rows: EvidenceSupportMatrixRow[] = matrix.cameras.flatMap(camera => {
        const base = {
            path: camera.profile,
            manufacturer: camera.manufacturer,
            line: camera.line,
            ...(camera.catalogLine && { catalogLine: camera.catalogLine }),
            model: camera.model,
            usb: camera.usb,
            quirks: { total: 0, simulated: 0, unverified: 0 },
        }
        const viewKey = (fidelity: MatrixFidelity, transport: MatrixTransport, profile: string, firmware?: string) =>
            `${fidelity}/${transport}/${profile}/${encodeURIComponent(camera.model)}/${encodeURIComponent(firmware ?? 'unknown')}`
        return [
            {
                ...base,
                viewKey: viewKey(camera.fidelity, camera.primaryTransport ?? 'usb', camera.profile, camera.firmware),
                profile: camera.profile,
                fidelity: camera.fidelity,
                ...(camera.primaryTransport && { transport: camera.primaryTransport }),
                results: camera.results,
                resultEvidence: camera.resultEvidence ?? {},
                source: latestEvidenceSource(camera.resultEvidence),
                ...(camera.firmware && { firmware: camera.firmware }),
                ...(camera.host && { host: camera.host }),
            },
            ...(camera.ptpIp
                ? [
                      {
                          ...base,
                          profile: camera.ptpIp.profile,
                          viewKey: viewKey(
                              camera.ptpIp.fidelity,
                              'ptp-ip',
                              camera.ptpIp.profile,
                              camera.ptpIp.firmware
                          ),
                          fidelity: camera.ptpIp.fidelity,
                          transport: 'ptp-ip' as const,
                          results: camera.ptpIp.results,
                          resultEvidence: camera.ptpIp.resultEvidence ?? {},
                          source: latestEvidenceSource(camera.ptpIp.resultEvidence),
                          ...(camera.ptpIp.firmware && { firmware: camera.ptpIp.firmware }),
                          ...(camera.ptpIp.host && { host: camera.ptpIp.host }),
                      },
                  ]
                : []),
        ]
    })
    return { generatedAt: matrix.generatedAt, capabilities: matrix.capabilities, rows, lines: [], totals: {} }
}

export interface CameraRowDetail {
    key: string
    fidelity: MatrixFidelity
    transport: MatrixTransport
    source: string
    at: string
    host?: string
    firmware?: string
    results: Record<string, CapabilityResult>
    resultEvidence?: Record<string, CapabilityEvidence>
}

export interface CameraHistoryEntry {
    runId: string
    source: string
    at: string
    fidelity: MatrixFidelity
    transport: MatrixTransport
    statuses: Record<string, CapabilityResult>
}

export interface CameraDetail {
    profileId: string
    indexed?: IndexedProfile
    rows: CameraRowDetail[]
    related: { profile: string; model: string; fidelity: string; path: string }[]
    history: CameraHistoryEntry[]
}

interface Cached<T> {
    signature: string
    value: T
}

/** Size and modification time, or "missing" for a file that disappeared since it was listed. */
function signatureOf(file: string): string {
    try {
        const stats = statSync(file)
        return `${stats.size}:${stats.mtimeMs}`
    } catch {
        return 'missing'
    }
}

export function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

export interface CompatDataOptions {
    /** Where matrices live (default packages/link/test-results). */
    resultsDirectory?: string
    runsDirectory?: string
    /** Extra matrices (*.json) or run logs (*.jsonl) to show, e.g. from `compat:ui -- --results <file>`. */
    extraResults?: string[]
}

export class CompatData {
    readonly resultsDirectory: string
    readonly importsDirectory: string
    readonly runsDirectory: string
    private readonly extraResults: string[]
    private catalogCache?: CameraCatalog
    private profileCache?: Map<string, IndexedProfile>
    private annotationCache?: Map<string, RowAnnotations>
    private jsonCache = new Map<string, Cached<SupportMatrix>>()
    private runCache = new Map<string, { signature: string; events: ProgressEvent[]; offset: number }>()
    private baseCache?: Cached<CompatView>

    constructor(options: CompatDataOptions = {}) {
        this.resultsDirectory = options.resultsDirectory ?? resultsDirectory
        this.importsDirectory = path.join(this.resultsDirectory, 'compat-imports')
        this.runsDirectory = options.runsDirectory ?? process.env.COMPAT_RUNS_DIRECTORY ?? defaultRunsDirectory
        this.extraResults = (options.extraResults ?? []).map(file => path.resolve(file))
    }

    get catalog(): CameraCatalog {
        return (this.catalogCache ??= loadCatalog())
    }

    get profiles(): Map<string, IndexedProfile> {
        return (this.profileCache ??= loadProfileIndex(this.catalog))
    }

    /** Forgets the profile index, e.g. after a capture was ingested into a new profile. */
    invalidateProfiles(): void {
        this.profileCache = undefined
        this.annotationCache = undefined
        this.baseCache = undefined
    }

    get annotations(): Map<string, RowAnnotations> {
        if (this.annotationCache) return this.annotationCache
        const annotations = new Map<string, RowAnnotations>()
        for (const [id, entry] of this.profiles) {
            if (entry.catalogModel?.unverified) annotations.set(id, { unverifiedModel: true })
        }
        return (this.annotationCache = annotations)
    }

    /** Completed matrices, oldest evidence first: simulation, combined hardware, per-camera hardware, imports. */
    matrixFiles(): MatrixFile[] {
        const files: MatrixFile[] = []
        const add = (file: string, label: string) => {
            if (existsSync(file))
                files.push({ id: `matrix:${path.relative(this.resultsDirectory, file)}`, label, file })
        }
        add(path.join(this.resultsDirectory, 'camera-support-matrix.json'), 'Simulation matrix')
        const merged = path.join(this.resultsDirectory, 'camera-compatibility.json')
        if (existsSync(merged)) {
            files.push({
                id: 'matrix:camera-compatibility.json',
                label: 'Merged compatibility matrix',
                file: merged,
                standalone: true,
            })
        }
        add(path.join(this.resultsDirectory, 'camera-lab-matrix.json'), 'Combined hardware matrix')
        for (const directory of [path.join(this.resultsDirectory, 'camera-lab'), this.importsDirectory]) {
            if (!existsSync(directory)) continue
            for (const name of readdirSync(directory).sort()) {
                if (name.endsWith('.json')) add(path.join(directory, name), `${path.basename(directory)}/${name}`)
            }
        }
        for (const file of this.extraResults.filter(file => file.endsWith('.json'))) {
            if (existsSync(file)) files.push({ id: `file:${file}`, label: path.basename(file), file })
        }
        return files
    }

    runFiles(): RunFile[] {
        const files = [
            ...(existsSync(this.runsDirectory)
                ? readdirSync(this.runsDirectory)
                      .filter(name => name.endsWith('.jsonl'))
                      .map(name => path.join(this.runsDirectory, name))
                : []),
            ...this.extraResults.filter(file => file.endsWith('.jsonl') && existsSync(file)),
        ]
        return files
            .flatMap(file => {
                try {
                    const stats = statSync(file)
                    return [{ runId: path.basename(file, '.jsonl'), file, modified: stats.mtimeMs, size: stats.size }]
                } catch {
                    return []
                }
            })
            .sort((left, right) => left.runId.localeCompare(right.runId))
    }

    readMatrix(file: string): SupportMatrix | undefined {
        try {
            const signature = signatureOf(file)
            const cached = this.jsonCache.get(file)
            if (cached?.signature === signature) return cached.value
            const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
            const value = matrixValue(
                isRecord(parsed) && Array.isArray(parsed.cameras)
                    ? rowsFromCompatibility(parsed as unknown as CompatibilityMatrix)
                    : parsed
            )
            if (!value) return undefined
            this.jsonCache.set(file, { signature, value })
            return value
        } catch {
            return undefined
        }
    }

    /** A run log's events; a growing log is read incrementally from where the last read stopped. */
    readRun(file: string): ProgressEvent[] {
        const cached = this.runCache.get(file)
        let buffer: Buffer
        let from: number
        let signature: string
        try {
            const stats = statSync(file)
            signature = `${stats.size}:${stats.mtimeMs}`
            if (cached?.signature === signature) return cached.events
            // A log that shrank was rewritten (or truncated), so it is read again from the start.
            from = cached && stats.size >= cached.offset ? cached.offset : 0
            buffer = readRange(file, from, stats.size - from)
        } catch {
            // Removed or unreadable since it was listed: keep what was read before, if anything.
            return cached?.events ?? []
        }
        // Only whole lines are consumed; a line still being written is read again next time.
        const complete = buffer.lastIndexOf(0x0a) + 1
        const events = parseProgress(buffer.subarray(0, complete).toString('utf8'))
        const value = from ? cached!.events.concat(events) : events
        this.runCache.set(file, { signature, events: value, offset: from + complete })
        return value
    }

    /** Whether a run log belongs to a run that is still going. */
    isActive(run: RunFile, events: ProgressEvent[]): boolean {
        if (events.some(event => event.type === 'run-end')) return false
        const start = events.find(event => event.type === 'run-start')
        if (!start || start.type !== 'run-start') return false
        if (Date.now() - run.modified > STALE_RUN_MILLISECONDS) return false
        // A log without a usable pid cannot prove its process is alive (and pid 0 is the process group).
        return start.pid > 0 && processAlive(start.pid)
    }

    /**
     * Latest results: every completed matrix, then the run logs that are newer than the simulation
     * matrix (or come from hardware), with the run in progress overlaid last.
     */
    view(): CompatView {
        const runs = this.runFiles()
        const parsed = runs.map(run => ({ run, events: this.readRun(run.file) }))
        const active = parsed.filter(({ run, events }) => this.isActive(run, events)).at(-1)
        const settled = parsed.filter(entry => entry !== active)
        const matrices = this.matrixFiles()
        const signature = JSON.stringify([
            matrices.map(matrix => [matrix.file, signatureOf(matrix.file)]),
            settled.map(({ run }) => [run.file, run.size, run.modified]),
        ])
        if (this.baseCache?.signature !== signature) {
            this.baseCache = { signature, value: this.buildBase(matrices, settled) }
        }
        const view = structuredClone(this.baseCache.value)
        view.generatedAt = new Date().toISOString()
        if (active) applyRun(view, active.events, { alive: true, annotations: this.annotations })
        view.runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        return view
    }

    private buildBase(matrices: MatrixFile[], runs: { run: RunFile; events: ProgressEvent[] }[]): CompatView {
        const view = emptyView()
        let simulationAt = ''
        for (const matrixFile of matrices) {
            const matrix = matrixFile.standalone ? undefined : this.readMatrix(matrixFile.file)
            if (!matrix) continue
            if (matrixFile.id === 'matrix:camera-support-matrix.json') simulationAt = matrix.generatedAt
            applyMatrix(
                view,
                matrix,
                {
                    label: matrixFile.label,
                    path: path.relative(packageDirectory, matrixFile.file),
                    generatedAt: matrix.generatedAt,
                },
                this.annotations
            )
        }
        for (const { events } of runs) {
            const start = events.find(event => event.type === 'run-start')
            if (!start || start.type !== 'run-start') continue
            const relevant = start.source === 'hardware' || start.at > simulationAt
            if (relevant) applyRun(view, events, { alive: false, annotations: this.annotations })
            else view.runs.push(summaryOnly(events))
        }
        return view
    }

    /** One past run (run log id) or one matrix ("matrix:<path>"), shown on its own. */
    singleView(id: string): CompatView | undefined {
        const matrixFile = this.matrixFiles().find(matrix => matrix.id === id)
        if (matrixFile) {
            const matrix = this.readMatrix(matrixFile.file)
            if (!matrix) return undefined
            const view = emptyView(matrix.capabilities)
            applyMatrix(
                view,
                matrix,
                {
                    label: matrixFile.label,
                    path: path.relative(packageDirectory, matrixFile.file),
                    generatedAt: matrix.generatedAt,
                },
                this.annotations
            )
            return view
        }
        const run = this.runFiles().find(candidate => candidate.runId === id)
        if (!run) return undefined
        const events = this.readRun(run.file)
        const view = emptyView()
        applyRun(view, events, { alive: this.isActive(run, events), annotations: this.annotations })
        return view
    }

    cameraDetail(profileId: string): CameraDetail | undefined {
        const indexed = this.profiles.get(profileId)
        const rows: CameraRowDetail[] = []
        const consider = (detail: CameraRowDetail) => {
            const existing = rows.findIndex(row => row.key === detail.key)
            if (existing < 0) rows.push(detail)
            else if (rows[existing].at <= detail.at) rows[existing] = detail
        }
        for (const matrixFile of this.matrixFiles()) {
            const matrix = this.readMatrix(matrixFile.file)
            for (const row of matrix?.rows.filter(candidate => candidate.profile === profileId) ?? []) {
                consider({
                    key: viewRowKey(row as EvidenceSupportMatrixRow),

                    fidelity: row.fidelity,
                    transport: row.transport ?? 'usb',
                    source: matrixFile.label,
                    at: row.source?.generatedAt ?? matrix!.generatedAt,
                    ...(row.host && { host: row.host }),
                    ...(row.firmware && { firmware: row.firmware }),
                    results: row.results,
                    resultEvidence:
                        (row as EvidenceSupportMatrixRow).resultEvidence ??
                        Object.fromEntries(
                            Object.keys(row.results).map(capability => [
                                capability,
                                {
                                    fidelity: row.fidelity,
                                    profile: row.profile,
                                    generatedAt: row.source?.generatedAt ?? matrix!.generatedAt,
                                    ...((row.source?.revision ?? matrix!.revision) && {
                                        revision: row.source?.revision ?? matrix!.revision,
                                    }),
                                    ...(row.firmware && { firmware: row.firmware }),
                                    ...(row.host && { host: row.host }),
                                },
                            ])
                        ),
                })
            }
        }
        const history = this.history(profileId)
        for (const entry of history) {
            if (Object.keys(entry.statuses).length === 0) continue
            consider({
                key: `${entry.fidelity}/${entry.transport}/${profileId}`,
                fidelity: entry.fidelity,
                transport: entry.transport,
                source: `run ${entry.runId}`,
                at: entry.at,
                results: entry.statuses,
            })
        }
        if (!indexed && rows.length === 0) return undefined
        const identities = new Set(indexed ? usbIdentities(indexed.profile) : [])
        const related = [...this.profiles.values()]
            .filter(entry => entry.profile.id !== profileId)
            .filter(entry => usbIdentities(entry.profile).some(identity => identities.has(identity)))
            .map(entry => ({
                profile: entry.profile.id,
                model: entry.profile.model,
                fidelity: entry.profile.provenance.fidelity,
                path: entry.path,
            }))
        return { profileId, ...(indexed && { indexed }), rows, related, history }
    }

    /** Every run log entry for a profile, newest first. */
    history(profileId: string): CameraHistoryEntry[] {
        const entries: CameraHistoryEntry[] = []
        for (const run of this.runFiles()) {
            const events = this.readRun(run.file)
            const start = events.find(event => event.type === 'run-start')
            if (!start || start.type !== 'run-start') continue
            for (const planned of start.rows.filter(row => row.profile === profileId)) {
                const statuses: Record<string, CapabilityResult> = {}
                let at = start.at
                for (const event of events) {
                    if (event.type !== 'capability' || event.key !== planned.key) continue
                    statuses[event.capability] = { status: event.status, detail: event.detail }
                    at = event.at
                }
                entries.push({
                    runId: start.runId,
                    source: start.source,
                    at,
                    fidelity: planned.fidelity,
                    transport: planned.transport,
                    statuses,
                })
            }
        }
        return entries.sort((left, right) => right.at.localeCompare(left.at))
    }

    gapReport(): GapReport {
        const matrices = this.matrixFiles()
            .filter(file => !file.standalone)
            .map(file => this.readMatrix(file.file))
            .filter((matrix): matrix is SupportMatrix => !!matrix)
        return buildGapReport(this.catalog, matrices)
    }
}

function readRange(file: string, from: number, length: number): Buffer {
    const buffer = Buffer.alloc(Math.max(0, length))
    const descriptor = openSync(file, 'r')
    try {
        readSync(descriptor, buffer, 0, buffer.length, from)
    } finally {
        closeSync(descriptor)
    }
    return buffer
}

/** A run's summary without applying its results (it is older than the simulation matrix). */
function summaryOnly(events: ProgressEvent[]) {
    const view = emptyView()
    const { summary } = applyRun(view, events, { alive: false })
    return summary!
}
