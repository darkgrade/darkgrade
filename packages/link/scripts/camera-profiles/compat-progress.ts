/**
 * Live progress for compatibility runs, as one JSON object per line (JSONL).
 *
 * The simulation suite and the standalone hardware runner append to
 * `test-results/compat-runs/<run id>.jsonl` while they work, so `bun run compat:ui` can show
 * progress per model and capability as it happens, and the file doubles as that run's result record.
 * Set COMPAT_RUNS_DIRECTORY to write elsewhere, or COMPAT_PROGRESS=off to write nothing.
 */
import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    rowKey,
    type CapabilityStatus,
    type MatrixFidelity,
    type MatrixTransport,
    type SupportMatrixRow,
} from './support-matrix'

export { rowKey }

export const PROGRESS_VERSION = 1
const KEPT_RUNS = 20

export const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const defaultRunsDirectory = path.join(packageDirectory, 'test-results/compat-runs')

export type RunSource = 'simulation' | 'hardware'

/** A row the run intends to evaluate, announced up front so viewers can show it as queued. */
export interface PlannedRow {
    key: string
    profile: string
    path: string
    manufacturer: string
    line: string
    catalogLine?: string
    model: string
    fidelity: MatrixFidelity
    scope?: 'line' | 'model'
    transport: MatrixTransport
    usb?: string[]
}

export type ProgressEvent =
    | {
          type: 'run-start'
          version: number
          runId: string
          at: string
          pid: number
          source: RunSource
          /** The URL-style filter the run was limited to, if any. */
          filter?: string
          capabilities: { id: string; label: string }[]
          rows: PlannedRow[]
      }
    | { type: 'capability-start'; runId: string; at: string; key: string; capability: string }
    | {
          type: 'capability'
          runId: string
          at: string
          key: string
          capability: string
          status: CapabilityStatus
          detail: string
          durationMilliseconds: number
      }
    /** The finished row without its results, which the preceding capability events carry. */
    | { type: 'row-end'; runId: string; at: string; key: string; row: Omit<SupportMatrixRow, 'results'> }
    | { type: 'run-end'; runId: string; at: string; outcome: 'completed' | 'failed'; matrix?: string }

export function newRunId(source: RunSource, now = new Date()): string {
    return `${now
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d+Z$/, 'Z')}-${source}-${process.pid}`
}

/** Appends progress events to a run's JSONL file. Each line is written whole, so readers can tail it. */
export class ProgressLog {
    private constructor(
        readonly runId: string,
        readonly file: string | undefined
    ) {}

    static start(options: {
        source: RunSource
        capabilities: { id: string; label: string }[]
        rows: PlannedRow[]
        filter?: string
        directory?: string
    }): ProgressLog {
        const runId = newRunId(options.source)
        const disabled = process.env.COMPAT_PROGRESS === 'off'
        const directory = options.directory ?? process.env.COMPAT_RUNS_DIRECTORY ?? defaultRunsDirectory
        const file = disabled ? undefined : path.join(directory, `${runId}.jsonl`)
        if (file) {
            mkdirSync(directory, { recursive: true })
            pruneRuns(directory)
        }
        const log = new ProgressLog(runId, file)
        log.write({
            type: 'run-start',
            version: PROGRESS_VERSION,
            runId,
            at: new Date().toISOString(),
            pid: process.pid,
            source: options.source,
            ...(options.filter && { filter: options.filter }),
            capabilities: options.capabilities,
            rows: options.rows,
        })
        return log
    }

    capabilityStarted(key: string, capability: string): void {
        this.write({ type: 'capability-start', runId: this.runId, at: new Date().toISOString(), key, capability })
    }

    capabilityFinished(
        key: string,
        capability: string,
        result: { status: CapabilityStatus; detail: string },
        durationMilliseconds: number
    ): void {
        this.write({
            type: 'capability',
            runId: this.runId,
            at: new Date().toISOString(),
            key,
            capability,
            status: result.status,
            detail: result.detail,
            durationMilliseconds,
        })
    }

    rowFinished({ results: _results, ...row }: SupportMatrixRow): void {
        this.write({ type: 'row-end', runId: this.runId, at: new Date().toISOString(), key: rowKey(row), row })
    }

    finish(outcome: 'completed' | 'failed', matrix?: string): void {
        this.write({
            type: 'run-end',
            runId: this.runId,
            at: new Date().toISOString(),
            outcome,
            ...(matrix && { matrix }),
        })
    }

    private write(event: ProgressEvent): void {
        if (this.file) appendFileSync(this.file, `${JSON.stringify(event)}\n`)
    }
}

/** Parses a run's JSONL text; a partially written last line (a run still in progress) is ignored. */
export function parseProgress(text: string): ProgressEvent[] {
    return text.split('\n').flatMap(line => {
        if (!line.trim()) return []
        try {
            const event = JSON.parse(line) as ProgressEvent
            return typeof event?.type === 'string' && typeof event.runId === 'string' ? [event] : []
        } catch {
            return []
        }
    })
}

/** The rows a run log finished, with their results rebuilt from its capability events. */
export function rowsFromProgress(events: ProgressEvent[]): SupportMatrixRow[] {
    const results = new Map<string, SupportMatrixRow['results']>()
    for (const event of events) {
        if (event.type !== 'capability') continue
        results.set(event.key, {
            ...results.get(event.key),
            [event.capability]: { status: event.status, detail: event.detail },
        })
    }
    return events.flatMap(event =>
        event.type === 'row-end' ? [{ ...event.row, results: results.get(event.key) ?? {} }] : []
    )
}

/** Keeps the newest run logs; older ones are removed when a new run starts. */
function pruneRuns(directory: string): void {
    const runs = readdirSync(directory)
        .filter(name => name.endsWith('.jsonl'))
        .map(name => ({ name, modified: statSync(path.join(directory, name)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified)
    for (const run of runs.slice(KEPT_RUNS - 1)) {
        rmSync(path.join(directory, run.name), { force: true })
        rmSync(path.join(directory, run.name.replace(/\.jsonl$/, '.matrix.json')), { force: true })
    }
}
