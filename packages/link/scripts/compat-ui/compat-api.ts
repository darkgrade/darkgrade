/**
 * What the compatibility HTTP API (`/api/v1`, served by `compat:ui`) and the MCP server
 * (`compat:mcp`) can read and do, over the same data layer the UI renders: cameras with their
 * results, run status and history, gaps with next actions, the catalog and profiles, and control
 * actions (start or cancel a simulation run, ingest a capture or result file, regenerate reports).
 * Methods return plain JSON-ready values and throw ApiError for a request that cannot be served.
 */
import { shortLineName } from '@scripts/camera-profiles/catalog-names'
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { matrixValue } from '@scripts/camera-profiles/compat-schema'
import type { CompatibilityMatrix } from '@scripts/camera-profiles/compatibility-matrix'
import {
    mergeCompatibility,
    renderCompatibility,
    renderReadmeCompatibility,
    replaceReadmeSection,
} from '@scripts/camera-profiles/compatibility-matrix'
import { usbIdentities } from '@scripts/camera-profiles/profile-index'
import { ingestCapture, ingestResults } from '@scripts/camera-profiles/standalone-ingest'
import { countStatuses, type SupportMatrix } from '@scripts/camera-profiles/support-matrix'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { format } from 'prettier'
import { CompatData } from './compat-data'
import {
    applyFilters,
    FIDELITIES,
    KINDS,
    parseFilters,
    serializeFilters,
    TRANSPORTS,
    type CompatFilters,
} from './compat-filters'
import { gapActions, renderGapsMarkdown, type GapAction, type GapActionKind } from './compat-gaps'
import type { CameraDetailModel } from './compat-pages'
import { SuiteRunner, type RunnerStatus } from './compat-runner'
import { cameraDetailModel } from './compat-site'
import { CELL_STATUSES, nameSlug, type CompatView, type RunSummary, type ViewRow } from './compat-view'

export const API_VERSION = 'v1'
const DEFAULT_LIMIT = 100
const MAXIMUM_LIMIT = 5_000

export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message)
    }
}

/** Filters as structured fields (the MCP tools' shape); the same keys as the UI's query string. */
export interface CameraQuery {
    profile?: string[]
    manufacturer?: string
    line?: string
    fidelity?: string[]
    transport?: string[]
    kind?: string[]
    unverified?: 'yes' | 'no'
    status?: Record<string, string[]>
    q?: string
    sort?: string
    order?: 'asc' | 'desc'
    run?: string
    limit?: number
    offset?: number
}

export interface CameraList {
    total: number
    offset: number
    limit: number
    /** The filter as a query string: open `/?<filter>` in the UI, or pass it to start a run. */
    filter: string
    capabilities: { id: string; label: string }[]
    rows: ViewRow[]
}

export interface RunStatus {
    generatedAt: string
    activeRun?: RunSummary
    /** The run this server started, if any (runs from a terminal or CI show only as activeRun). */
    runner: RunnerStatus
    latestRuns: RunSummary[]
}

export interface GapLine {
    manufacturer: string
    manufacturerSlug: string
    line: string
    lineSlug: string
    catalogLine: string
    protocolFamily: string
    models: number
    mockedModels: number
    evidence: { captured: string[]; hardware: string[] }
    noDataCells: number
    cells: number
    actions: GapAction[]
}

export interface GapSummary {
    workflowLimitations: string[]
    matrixGeneratedAt?: string
    totals: Record<string, number>
    actionCounts: Partial<Record<GapActionKind, number>>
    manufacturers: { name: string; slug: string; vendorDefinitions: boolean; lines: GapLine[] }[]
}

export interface IngestRequest {
    captures?: { profile: string; file: string; bus?: number; address?: number }[]
    results?: string[]
    /** Re-run the simulation suite for the captured profiles afterwards. */
    simulate?: boolean
    /** Rebuild the hardware and merged matrices afterwards. */
    merge?: boolean
}

export type ReportTarget = 'merge' | 'readme' | 'gaps'
export const REPORT_TARGETS: ReportTarget[] = ['merge', 'readme', 'gaps']

export interface CompatApiOptions {
    data?: CompatData
    runner?: SuiteRunner
    /** Where the gaps report is written (default packages/link/GAPS.md). */
    gapsFile?: string
    /** The README whose camera-compatibility section is regenerated (default the repository README). */
    readmeFile?: string
    /** Where ingested captures start new profiles (default camera-profiles/). */
    profileDirectory?: string
}

function expandHome(file: string): string {
    return file.startsWith('~/') ? path.join(homedir(), file.slice(2)) : file
}

function existingFile(file: unknown, what: string): string {
    if (typeof file !== 'string' || !file.trim()) throw new ApiError(400, `${what} needs a file path`)
    const resolved = path.resolve(expandHome(file.trim()))
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new ApiError(400, `${resolved} is not a file`)
    return resolved
}

function clampNumber(value: unknown, fallback: number, maximum: number): number {
    const number = typeof value === 'string' ? Number(value) : value
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return fallback
    return Math.min(Math.floor(number), maximum)
}

/** A structured query as the UI's query string, so both share one parser. */
export function queryString(query: CameraQuery): string {
    const parameters = new URLSearchParams()
    const list = (key: string, values: string[] | undefined) => {
        if (values?.length) parameters.set(key, values.join(','))
    }
    list('profile', query.profile)
    if (query.manufacturer) parameters.set('manufacturer', query.manufacturer)
    if (query.line) parameters.set('line', query.line)
    list('fidelity', query.fidelity)
    list('transport', query.transport)
    list('kind', query.kind)
    if (query.unverified) parameters.set('unverified', query.unverified)
    for (const [capability, statuses] of Object.entries(query.status ?? {})) list(capability, statuses)
    if (query.q) parameters.set('q', query.q)
    if (query.sort) parameters.set('sort', query.sort)
    if (query.order) parameters.set('order', query.order)
    if (query.run) parameters.set('run', query.run)
    if (query.limit !== undefined) parameters.set('limit', String(query.limit))
    if (query.offset !== undefined) parameters.set('offset', String(query.offset))
    return parameters.toString()
}

export class CompatApi {
    readonly data: CompatData
    readonly runner: SuiteRunner
    private writing?: Promise<unknown>

    constructor(private readonly options: CompatApiOptions = {}) {
        this.data = options.data ?? new CompatData()
        this.runner =
            options.runner ??
            new SuiteRunner({
                logFile: path.join(this.data.resultsDirectory, 'compat-ui-run.log'),
                environment: { COMPAT_RUNS_DIRECTORY: this.data.runsDirectory },
            })
    }

    view(run?: string | null): CompatView {
        const view = run ? this.data.singleView(run) : this.data.view()
        if (!view) throw new ApiError(404, `No run or result file "${run}"`)
        return view
    }

    /** Rows matching the UI's filters (a query string or structured fields), paged. */
    listCameras(query: string | URLSearchParams | CameraQuery = ''): CameraList {
        const parameters =
            typeof query === 'string' || query instanceof URLSearchParams
                ? new URLSearchParams(query)
                : new URLSearchParams(queryString(query))
        const view = this.view(parameters.get('run'))
        const filters: CompatFilters = parseFilters(
            parameters,
            view.capabilities.map(capability => capability.id)
        )
        const rows = applyFilters(view.rows, filters)
        const offset = clampNumber(parameters.get('offset'), 0, Number.MAX_SAFE_INTEGER)
        const limit = clampNumber(parameters.get('limit'), DEFAULT_LIMIT, MAXIMUM_LIMIT)
        return {
            total: rows.length,
            offset,
            limit,
            filter: serializeFilters({ ...filters, run: undefined }),
            capabilities: view.capabilities,
            rows: rows.slice(offset, offset + limit),
        }
    }

    camera(profileId: string, run?: string | null): { camera: CameraDetailModel; rows: ViewRow[] } {
        const view = this.view(run)
        const camera = cameraDetailModel(this.data, view, profileId)
        if (!camera) throw new ApiError(404, `No camera profile "${profileId}"`)
        return { camera, rows: view.rows.filter(row => row.profile === profileId) }
    }

    status(): RunStatus {
        const view = this.data.view()
        return {
            generatedAt: view.generatedAt,
            ...(view.activeRun && { activeRun: view.activeRun }),
            runner: this.runner.status(),
            latestRuns: view.runs.slice(0, 5),
        }
    }

    runs(limit?: unknown): RunSummary[] {
        return this.data.view().runs.slice(0, clampNumber(limit, 50, 1_000))
    }

    run(runId: string): { summary?: RunSummary; rows: ViewRow[] } {
        const view = this.view(runId)
        return { ...(view.runs[0] && { summary: view.runs[0] }), rows: view.rows }
    }

    gaps(
        filter: { manufacturer?: string; line?: string; kind?: string; area?: string; all?: boolean } = {}
    ): GapSummary {
        const report = this.data.gapReport()
        const actionCounts: Partial<Record<GapActionKind, number>> = {}
        const manufacturers = report.manufacturers
            .map(manufacturer => {
                const manufacturerSlug = nameSlug(manufacturer.name)
                const lines = manufacturer.lines.flatMap(line => {
                    const lineSlug = nameSlug(line.line)
                    if (filter.line && filter.line !== lineSlug) return []
                    const actions = gapActions(line, manufacturer).filter(
                        action =>
                            (!filter.kind || action.kind === filter.kind) &&
                            (!filter.area || action.area === filter.area)
                    )
                    if (!actions.length && !filter.all) return []
                    for (const action of actions) actionCounts[action.kind] = (actionCounts[action.kind] ?? 0) + 1
                    return [
                        {
                            manufacturer: manufacturer.name,
                            manufacturerSlug,
                            line: line.line,
                            lineSlug,
                            catalogLine: line.catalogLine,
                            protocolFamily: line.protocolFamily,
                            models: line.models,
                            mockedModels: line.mockedModels,
                            evidence: { captured: line.capturedProfiles, hardware: line.hardwareProfiles },
                            noDataCells: line.noDataCells,
                            cells: line.cells,
                            actions,
                        },
                    ]
                })
                return {
                    name: manufacturer.name,
                    slug: manufacturerSlug,
                    vendorDefinitions: manufacturer.vendorDefinitions,
                    lines,
                }
            })
            .filter(
                manufacturer =>
                    (!filter.manufacturer || manufacturer.slug === filter.manufacturer) && manufacturer.lines.length
            )
        return {
            ...(report.matrixGeneratedAt && { matrixGeneratedAt: report.matrixGeneratedAt }),
            totals: report.totals,
            workflowLimitations: report.workflowLimitations,
            actionCounts,
            manufacturers,
        }
    }

    gapsMarkdown(): string {
        return renderGapsMarkdown(this.data.gapReport())
    }

    catalog() {
        const profiles = [...this.data.profiles.values()]
        const fidelityCounts: Record<string, number> = {}
        for (const entry of profiles) {
            const fidelity = entry.profile.provenance.fidelity
            fidelityCounts[fidelity] = (fidelityCounts[fidelity] ?? 0) + 1
        }
        return {
            capabilities: this.data.view().capabilities,
            fidelities: FIDELITIES,
            transports: TRANSPORTS,
            kinds: KINDS,
            statuses: CELL_STATUSES,
            profiles: { total: profiles.length, byFidelity: fidelityCounts },
            manufacturers: this.data.catalog.manufacturers.map(manufacturer => ({
                name: manufacturer.name,
                slug: nameSlug(manufacturer.name.replace(/ \(other\)$/, '')),
                usbVendorId: manufacturer.usbVendorId,
                ptpVendorExtensionId: manufacturer.ptpVendorExtensionId,
                lines: manufacturer.lines.map(line => ({
                    name: shortLineName(manufacturer, line),
                    slug: nameSlug(shortLineName(manufacturer, line)),
                    catalogLine: line.name,
                    protocolFamily: line.protocolFamily,
                    models: line.models.length,
                    unverifiedModels: line.models.filter(model => model.unverified).length,
                    quirks: line.quirks.map(quirk => ({ id: quirk.id, unverified: !!quirk.unverified })),
                    ...(line.note && { note: line.note }),
                })),
            })),
        }
    }

    profiles(query: { manufacturer?: string; fidelity?: string; q?: string; limit?: unknown; offset?: unknown } = {}) {
        const terms = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
        const matches = [...this.data.profiles.values()]
            .map(entry => ({
                id: entry.profile.id,
                model: entry.profile.model,
                manufacturer: entry.profile.manufacturer,
                line: entry.profile.line,
                fidelity: entry.profile.provenance.fidelity,
                path: entry.path,
                usb: usbIdentities(entry.profile),
                quirks: entry.profile.quirks.length,
                unverified: entry.profile.quirks.some(quirk => quirk.unverified) || !!entry.catalogModel?.unverified,
            }))
            .filter(entry => !query.manufacturer || nameSlug(entry.manufacturer) === query.manufacturer)
            .filter(entry => !query.fidelity || entry.fidelity === query.fidelity)
            .filter(entry => {
                const haystack = `${entry.id} ${entry.model} ${entry.line} ${entry.usb.join(' ')}`.toLowerCase()
                return terms.every(term => haystack.includes(term))
            })
        const offset = clampNumber(query.offset, 0, Number.MAX_SAFE_INTEGER)
        const limit = clampNumber(query.limit, DEFAULT_LIMIT, MAXIMUM_LIMIT)
        return { total: matches.length, offset, limit, profiles: matches.slice(offset, offset + limit) }
    }

    /** Starts the simulation suite for a filter (the UI's query string, or structured fields). */
    startRun(request: { filter?: unknown; filters?: CameraQuery } = {}) {
        if (request.filter !== undefined && typeof request.filter !== 'string') {
            throw new ApiError(400, 'filter must be a query string such as "manufacturer=sony&transport=ptp-ip"')
        }
        const filter = request.filters
            ? queryString({ ...request.filters, limit: undefined, offset: undefined, run: undefined })
            : (request.filter ?? '').trim().replace(/^\?/, '')
        const result = this.runner.start(filter)
        if (!result.started) throw new ApiError(409, result.message)
        return { ...result, filter }
    }

    cancelRun() {
        const result = this.runner.cancel()
        if (!result.cancelled) throw new ApiError(409, result.message)
        return result
    }

    async ingest(request: IngestRequest) {
        if (!request.captures?.length && !request.results?.length) {
            throw new ApiError(400, 'Pass captures ([{ profile, file }]) and/or results ([file])')
        }
        const messages: string[] = []
        const written: string[] = []
        const captured: string[] = []
        for (const capture of request.captures ?? []) {
            if (typeof capture?.profile !== 'string' || !/^[a-z0-9-]+$/.test(capture.profile)) {
                throw new ApiError(400, 'Each capture needs a profile id (lowercase letters, digits and hyphens)')
            }
            const file = existingFile(capture.file, `Capture for ${capture.profile}`)
            const address =
                Number.isInteger(capture.bus) && Number.isInteger(capture.address)
                    ? { bus: capture.bus!, address: capture.address! }
                    : undefined
            const result = await ingestCapture(capture.profile, file, {
                index: this.data.profiles,
                ...(address && { address }),
                ...(this.options.profileDirectory && { profileDirectory: this.options.profileDirectory }),
            }).catch((error: unknown) => {
                throw new ApiError(422, error instanceof Error ? error.message : String(error))
            })
            written.push(result.file)
            captured.push(result.profile.id)
            messages.push(`Wrote ${path.relative(packageDirectory, result.file)}`)
            if (result.reportedModel) messages.push(`The capture's DeviceInfo reports "${result.reportedModel}".`)
        }
        for (const entry of request.results ?? []) {
            const file = existingFile(entry, 'A results entry')
            try {
                const result = ingestResults(file, {
                    hardwareDirectory: path.join(this.data.resultsDirectory, 'camera-lab'),
                    runsDirectory: this.data.runsDirectory,
                })
                written.push(...result.written)
                messages.push(
                    result.rows.length
                        ? `Took ${result.rows.length} hardware rows from ${path.basename(file)}`
                        : `${path.basename(file)} has no hardware rows; it is kept for the UI only.`
                )
            } catch (error) {
                throw new ApiError(422, error instanceof Error ? error.message : String(error))
            }
        }
        if (captured.length) this.data.invalidateProfiles()
        const run = request.simulate && captured.length ? this.runner.start(`profile=${captured.join(',')}`) : undefined
        if (run) messages.push(run.message)
        const reports = request.merge ? await this.regenerate({ targets: ['merge'] }) : undefined
        return { written, captured, messages, ...(run && { run }), ...(reports && { reports }) }
    }

    /** Rebuilds the merged matrix, the README compatibility section and/or the gaps report, in that order. */
    async regenerate(request: { targets?: unknown } = {}) {
        const requested = Array.isArray(request.targets) ? request.targets : ['merge', 'readme', 'gaps']
        const unknown = requested.filter(target => !REPORT_TARGETS.includes(target as ReportTarget))
        if (unknown.length)
            throw new ApiError(400, `Unknown report targets: ${unknown.join(', ')} (use ${REPORT_TARGETS.join(', ')})`)
        // One regeneration at a time; a second request waits for the first.
        const previous = this.writing
        const work = (async () => {
            await previous?.catch(() => undefined)
            const written: string[] = []
            for (const target of REPORT_TARGETS.filter(target => requested.includes(target))) {
                written.push(...(await this.regenerateOne(target)))
            }
            return { written: written.map(file => path.relative(packageDirectory, file) || file) }
        })()
        this.writing = work
        return work
    }

    private async regenerateOne(target: ReportTarget): Promise<string[]> {
        const results = this.data.resultsDirectory
        if (target === 'gaps') {
            const report = this.data.gapReport()
            if (!report.matrixGeneratedAt)
                throw new ApiError(409, 'No simulation matrix yet; run the simulation suite first')
            const file = this.options.gapsFile ?? path.join(packageDirectory, 'GAPS.md')
            writeFileSync(file, await format(renderGapsMarkdown(report), { parser: 'markdown', proseWrap: 'preserve' }))
            return [file]
        }
        if (target === 'readme') {
            const merged = path.join(results, 'camera-compatibility.json')
            if (!existsSync(merged)) throw new ApiError(409, 'No merged matrix yet; regenerate "merge" first')
            const matrix = JSON.parse(readFileSync(merged, 'utf8')) as CompatibilityMatrix
            const readme = this.options.readmeFile ?? path.join(packageDirectory, '../../README.md')
            try {
                writeFileSync(
                    readme,
                    replaceReadmeSection(readFileSync(readme, 'utf8'), renderReadmeCompatibility(matrix))
                )
            } catch (error) {
                throw new ApiError(422, error instanceof Error ? error.message : String(error))
            }
            return [readme]
        }
        return this.merge()
    }

    /** The combined hardware matrix (when there are hardware results) and the merged matrix. */
    private merge(): string[] {
        const results = this.data.resultsDirectory
        const read = (file: string) => matrixValue(JSON.parse(readFileSync(file, 'utf8')))
        const simulationFile = path.join(results, 'camera-support-matrix.json')
        if (!existsSync(simulationFile))
            throw new ApiError(409, 'No simulation matrix yet; run the simulation suite first')
        const simulation = read(simulationFile)
        if (!simulation) throw new ApiError(422, `${simulationFile} is not a support matrix`)
        const written: string[] = []
        const hardwareDirectory = path.join(results, 'camera-lab')
        const hardwareFile = path.join(results, 'camera-lab-matrix.json')
        const hardwareRows = existsSync(hardwareDirectory)
            ? readdirSync(hardwareDirectory)
                  .filter(name => name.endsWith('.json'))
                  .flatMap(name => read(path.join(hardwareDirectory, name))?.rows ?? [])
                  .filter(row => row.fidelity === 'hardware')
            : []
        if (hardwareRows.length) {
            const combined: SupportMatrix = {
                generatedAt: new Date().toISOString(),
                capabilities: simulation.capabilities,
                rows: hardwareRows,
                lines: [],
                totals: { hardware: countStatuses(hardwareRows) },
            }
            writeFileSync(hardwareFile, `${JSON.stringify(combined, null, 2)}\n`)
            written.push(hardwareFile)
        }
        const hardware = existsSync(hardwareFile) ? read(hardwareFile) : undefined
        const merged = mergeCompatibility(simulation, hardware, {
            simulation: path.relative(packageDirectory, simulationFile),
            ...(hardware && { hardware: path.relative(packageDirectory, hardwareFile) }),
        })
        const output = path.join(results, 'camera-compatibility.json')
        writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`)
        writeFileSync(output.replace(/\.json$/, '.md'), renderCompatibility(merged))
        written.push(output, output.replace(/\.json$/, '.md'))
        return written
    }
}
