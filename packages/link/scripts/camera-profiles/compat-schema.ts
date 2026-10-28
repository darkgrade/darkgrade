/**
 * Validation for the result files the compatibility UI, API and MCP server read: support matrices
 * (*.json) and run progress logs (*.jsonl). These files come from other machines, older versions,
 * runs killed mid-write and hand edits, so every field is checked and clipped. A record that cannot
 * identify itself is dropped; anything else is kept with safe defaults, and unrecognised status values
 * are kept as they are so viewers can show them as unknown instead of guessing. No Node imports, so the
 * browser bundle can use it too.
 */
import type { PlannedRow, ProgressEvent } from './compat-progress'
import type { CapabilityEvidence } from './compatibility-matrix'
import {
    rowKey,
    type CapabilityResult,
    type MatrixTransport,
    type SupportMatrix,
    type SupportMatrixRow,
} from './support-matrix'

/** Longest identity text (model, line, profile id) kept; longer values are clipped. */
export const IDENTITY_LIMIT = 200
/** Longest result message kept from a file. */
export const DETAIL_LIMIT = 4000

const FIDELITIES = ['hardware', 'captured', 'documented']
/** Keys that would reach an object's prototype if used as capability ids. */
const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype']

function safeKey(key: string | undefined): key is string {
    return !!key && key.length <= 80 && !UNSAFE_KEYS.includes(key)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string (or finite number) as clipped text; anything else is undefined. */
export function textValue(value: unknown, limit = IDENTITY_LIMIT): string | undefined {
    const text =
        typeof value === 'string'
            ? value
            : typeof value === 'number' && Number.isFinite(value)
              ? String(value)
              : undefined
    if (text === undefined) return undefined
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

export function finiteNumberValue(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function countValue(value: unknown): number {
    const number = finiteNumberValue(value)
    return number !== undefined && number > 0 ? Math.floor(number) : 0
}

function stringList(value: unknown, limit = IDENTITY_LIMIT): string[] {
    return Array.isArray(value) ? value.flatMap(item => textValue(item, limit) ?? []) : []
}

/** Fidelity as written when it is one of the known tiers, otherwise "unknown". */
export function fidelityValue(value: unknown): SupportMatrixRow['fidelity'] | 'unknown' {
    return typeof value === 'string' && FIDELITIES.includes(value) ? (value as SupportMatrixRow['fidelity']) : 'unknown'
}

export function capabilityList(value: unknown): { id: string; label: string }[] {
    if (!Array.isArray(value)) return []
    const seen = new Set<string>()
    return value.flatMap(item => {
        const id = isRecord(item) ? textValue(item.id, 80) : textValue(item, 80)
        if (!safeKey(id) || seen.has(id)) return []
        seen.add(id)
        return [{ id, label: (isRecord(item) && textValue(item.label, 80)) || id }]
    })
}

/** A capability result; a missing status reads as no data, an unrecognised one is kept verbatim. */
export function resultValue(value: unknown): CapabilityResult {
    if (!isRecord(value)) return { status: 'no-data', detail: '' }
    const status = textValue(value.status, 40) || 'no-data'
    return { status: status as CapabilityResult['status'], detail: textValue(value.detail, DETAIL_LIMIT) ?? '' }
}

function resultsValue(value: unknown): Record<string, CapabilityResult> {
    if (!isRecord(value)) return {}
    const results: Record<string, CapabilityResult> = {}
    for (const [capability, result] of Object.entries(value)) {
        if (safeKey(capability)) results[capability] = resultValue(result)
    }
    return results
}

/**
 * The identity fields every row-shaped record shares (matrix rows, planned rows, finished rows),
 * or undefined when it has no profile id. Only checked fields cross the file boundary.
 */
export function identityValue(value: Record<string, unknown>) {
    const profile = textValue(value.profile)
    if (!profile) return undefined
    const transport: MatrixTransport | undefined =
        value.transport === 'ptp-ip' || value.transport === 'usb' ? value.transport : undefined
    const scope: SupportMatrixRow['scope'] = value.scope === 'line' || value.scope === 'model' ? value.scope : undefined
    const catalogLine = textValue(value.catalogLine)
    const firmware = textValue(value.firmware)
    const host = textValue(value.host)
    const labCamera = textValue(value.labCamera)
    return {
        profile,
        path: textValue(value.path, 400) ?? profile,
        manufacturer: textValue(value.manufacturer) || 'Unknown',
        line: textValue(value.line) || 'Unknown',
        model: textValue(value.model) || profile,
        fidelity: fidelityValue(value.fidelity) as SupportMatrixRow['fidelity'],
        ...(catalogLine && { catalogLine }),
        ...(Array.isArray(value.usb) && { usb: stringList(value.usb, 20) }),
        ...(scope && { scope }),
        ...(transport && { transport }),
        ...(firmware && { firmware }),
        ...(host && { host }),
        ...(labCamera && { labCamera }),
    }
}

function quirkCounts(value: unknown): SupportMatrixRow['quirks'] {
    const quirks = isRecord(value) ? value : {}
    return {
        total: countValue(quirks.total),
        simulated: countValue(quirks.simulated),
        unverified: countValue(quirks.unverified),
    }
}

function observationTime(value: unknown): string | undefined {
    return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : undefined
}

/** Invalid supplied source time stays unknown; the aggregate header must not freshen it. */
function sourceValue(value: unknown): NonNullable<SupportMatrixRow['source']> {
    const source = isRecord(value) ? value : {}
    const revision = textValue(source.revision)
    return { generatedAt: observationTime(source.generatedAt) ?? '', ...(revision && { revision }) }
}

function evidenceValue(value: unknown): CapabilityEvidence | undefined {
    if (!isRecord(value) || typeof value.fidelity !== 'string' || !FIDELITIES.includes(value.fidelity)) return undefined
    const profile = textValue(value.profile)
    const generatedAt = observationTime(value.generatedAt)
    if (!profile || !generatedAt) return undefined
    const firmware = textValue(value.firmware),
        host = textValue(value.host),
        revision = textValue(value.revision)
    return {
        fidelity: value.fidelity as CapabilityEvidence['fidelity'],
        profile,
        generatedAt,
        ...(firmware && { firmware }),
        ...(host && { host }),
        ...(revision && { revision }),
    }
}

/** Keep bounded, nonrecursive conflict sources and reject invalid provenance instead of inventing a tier. */
function evidenceMapValue(value: unknown): Record<string, CapabilityEvidence> {
    const entries: Record<string, CapabilityEvidence> = {}
    if (!isRecord(value)) return entries
    for (const [key, candidate] of Object.entries(value).slice(0, 256)) {
        if (!safeKey(key)) continue
        const evidence = evidenceValue(candidate)
        if (!evidence) continue
        const conflicts =
            isRecord(candidate) && Array.isArray(candidate.conflicts)
                ? candidate.conflicts.slice(0, 32).flatMap(conflict => {
                      const source = evidenceValue(conflict)
                      if (
                          !source ||
                          !isRecord(conflict) ||
                          !['pass', 'fail', 'unsupported', 'no-data'].includes(String(conflict.status))
                      )
                          return []
                      return [{ ...source, ...resultValue(conflict) }]
                  })
                : []
        entries[key] = { ...evidence, ...(conflicts.length && { conflicts }) }
    }
    return entries
}

export type ValidatedMatrixRow = SupportMatrixRow & {
    resultEvidence?: Record<string, CapabilityEvidence>
    viewKey?: string
}

export function matrixRowValue(value: unknown): ValidatedMatrixRow | undefined {
    if (!isRecord(value)) return undefined
    const fields = identityValue(value)
    if (!fields) return undefined
    const viewKey = textValue(value.viewKey, 6000)
    const prefix = `${fields.fidelity}/${fields.transport ?? 'usb'}/${fields.profile}/`
    return {
        ...fields,
        quirks: quirkCounts(value.quirks),
        results: resultsValue(value.results),
        ...('source' in value && { source: sourceValue(value.source) }),
        ...('resultEvidence' in value && { resultEvidence: evidenceMapValue(value.resultEvidence) }),
        ...(viewKey?.startsWith(prefix) && !/[\u0000-\u001f]/.test(viewKey) && { viewKey }),
    }
}

/** A finished row as a run log's row-end event carries it (without results). */
export function finishedRowValue(value: unknown): Omit<SupportMatrixRow, 'results'> | undefined {
    if (!isRecord(value)) return undefined
    const fields = identityValue(value)
    return (
        fields && {
            ...fields,
            quirks: quirkCounts(value.quirks),
            ...('source' in value && { source: sourceValue(value.source) }),
        }
    )
}

/** A support matrix with every row checked; undefined when it has no rows array. */
export function matrixValue(value: unknown): SupportMatrix | undefined {
    if (!isRecord(value) || !Array.isArray(value.rows)) return undefined
    const { ptpIp, catalogModels, ...rest } = value
    return {
        ...(rest as unknown as SupportMatrix),
        generatedAt: textValue(value.generatedAt, 40) ?? '',
        capabilities: capabilityList(value.capabilities),
        rows: value.rows.flatMap(row => matrixRowValue(row) ?? []),
        lines: Array.isArray(value.lines) ? (value.lines as SupportMatrix['lines']) : [],
        totals: isRecord(value.totals) ? (value.totals as SupportMatrix['totals']) : {},
        ...(isRecord(ptpIp) && { ptpIp: ptpIpValue(ptpIp) }),
        ...(isRecord(catalogModels) && { catalogModels: catalogModelsValue(catalogModels) }),
    }
}

function textRecords<Key extends string>(value: unknown, keys: Key[]): Record<Key, string>[] {
    if (!Array.isArray(value)) return []
    return value.flatMap(item =>
        isRecord(item)
            ? [Object.fromEntries(keys.map(key => [key, textValue(item[key], 400) ?? ''])) as Record<Key, string>]
            : []
    )
}

function statusCounts(value: unknown): Record<'pass' | 'fail' | 'unsupported' | 'no-data', number> {
    const counts = isRecord(value) ? value : {}
    return {
        pass: countValue(counts.pass),
        fail: countValue(counts.fail),
        unsupported: countValue(counts.unsupported),
        'no-data': countValue(counts['no-data']),
    }
}

function ptpIpValue(value: Record<string, unknown>): NonNullable<SupportMatrix['ptpIp']> {
    return {
        simulated: countValue(value.simulated),
        totals: statusCounts(value.totals),
        notSimulated: textRecords(value.notSimulated, ['manufacturer', 'line', 'reason']),
    }
}

function catalogModelsValue(value: Record<string, unknown>): NonNullable<SupportMatrix['catalogModels']> {
    return {
        simulated: countValue(value.simulated),
        skipped: textRecords(value.skipped, ['manufacturer', 'line', 'model', 'reason']),
        totals: statusCounts(value.totals),
    }
}

function plannedRowValue(value: unknown): PlannedRow | undefined {
    if (!isRecord(value)) return undefined
    const fields = identityValue(value)
    if (!fields) return undefined
    return {
        key: textValue(value.key, 400) ?? rowKey(fields),
        profile: fields.profile,
        path: fields.path,
        manufacturer: fields.manufacturer,
        line: fields.line,
        model: fields.model,
        fidelity: fields.fidelity,
        ...(fields.catalogLine && { catalogLine: fields.catalogLine }),
        ...(fields.scope && { scope: fields.scope }),
        transport: fields.transport ?? 'usb',
        ...(fields.usb && { usb: fields.usb }),
    }
}

/** One log line as an event, or undefined when it is not a well-formed event of a known type. */
export function progressEventValue(value: unknown): ProgressEvent | undefined {
    if (!isRecord(value)) return undefined
    const runId = textValue(value.runId)
    const at = textValue(value.at, 40) ?? ''
    if (!runId) return undefined
    const key = textValue(value.key, 400)
    const capability = textValue(value.capability, 80)
    switch (value.type) {
        case 'run-start': {
            const filter = textValue(value.filter, 2000)
            return {
                type: 'run-start',
                version: countValue(value.version),
                runId,
                at,
                pid: countValue(value.pid),
                source: value.source === 'hardware' ? 'hardware' : 'simulation',
                ...(filter && { filter }),
                capabilities: capabilityList(value.capabilities),
                rows: Array.isArray(value.rows) ? value.rows.flatMap(row => plannedRowValue(row) ?? []) : [],
            }
        }
        case 'capability-start':
            return key && capability ? { type: 'capability-start', runId, at, key, capability } : undefined
        case 'capability': {
            if (!key || !capability) return undefined
            const { status, detail } = resultValue(value)
            const durationMilliseconds = finiteNumberValue(value.durationMilliseconds) ?? 0
            return { type: 'capability', runId, at, key, capability, status, detail, durationMilliseconds }
        }
        case 'row-end': {
            const row = finishedRowValue(value.row)
            return key && row ? { type: 'row-end', runId, at, key, row } : undefined
        }
        case 'run-end': {
            const matrix = textValue(value.matrix, 400)
            const outcome = value.outcome === 'completed' ? 'completed' : 'failed'
            return { type: 'run-end', runId, at, outcome, ...(matrix && { matrix }) }
        }
        default:
            return undefined
    }
}
