/**
 * Turns what is recorded during standalone testing into profile and matrix data (see
 * scripts/compat/ingest-standalone.ts for the command line).
 */
import {
    validateCameraProfile,
    type CameraProfile,
    type ProfileSource,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { format } from 'prettier'
import { slug } from './camera-catalog'
import { applyCapture, canonicalOrder, type CaptureTarget } from './capture-ingest'
import { defaultRunsDirectory, parseProgress, rowsFromProgress } from './compat-progress'
import { loadProfileIndex, profileDirectory, type IndexedProfile } from './profile-index'
import { hardwareMatrixName, hardwareResultsDirectory, writeMatrix } from './standalone-run'
import type { SupportMatrix, SupportMatrixRow } from './support-matrix'

/** A profile plus deduplicating source and exchange registration. */
function captureTarget(profile: CameraProfile): CaptureTarget {
    const key = (source: ProfileSource) => `${source.location}\u0000${source.excerpt ?? ''}`
    const exchangeKey = (exchange: RecordedExchange) =>
        JSON.stringify([exchange.operation, exchange.parameters, exchange.dataFromHost, exchange.response])
    return {
        profile,
        addSource(source) {
            const existing = profile.provenance.sources.findIndex(candidate => key(candidate) === key(source))
            return existing >= 0 ? existing : profile.provenance.sources.push(source) - 1
        },
        addExchange(exchange) {
            if (!profile.exchanges.some(existing => exchangeKey(existing) === exchangeKey(exchange)))
                profile.exchanges.push(exchange)
        },
    }
}

/**
 * The committed captured profile for an id, or a new captured profile carrying a per-model mock's
 * catalog identity and none of its documented facts.
 */
function capturedProfileFor(
    indexed: IndexedProfile | undefined,
    profileId: string,
    directory: string
): { profile: CameraProfile; file: string } {
    if (!indexed) throw new Error(`No profile "${profileId}"; use an id from the compatibility UI (camera page).`)
    const { profile } = indexed
    if (profile.provenance.fidelity === 'captured') {
        const relative = indexed.path.replace(/^camera-profiles\//, '')
        return { profile: structuredClone(profile), file: path.join(directory, relative) }
    }
    if (!indexed.catalogModel) {
        throw new Error(`${profileId} is a line mock; capture against a model (its per-model mock id) instead.`)
    }
    const fresh: CameraProfile = {
        schemaVersion: 1,
        id: profile.id,
        manufacturer: profile.manufacturer,
        line: profile.line,
        model: profile.model,
        ...(profile.usb && { usb: { vendorId: profile.usb.vendorId, productIds: profile.usb.productIds, source: 0 } }),
        ...(profile.catalog && { catalog: profile.catalog }),
        // The USB identity comes from the catalog entry; everything else will come from the capture.
        provenance: {
            fidelity: 'captured',
            sources: [{ location: indexed.catalogModel.usbIdSource ?? indexed.catalogModel.source }],
        },
        properties: [],
        exchanges: [],
        events: [],
        quirks: [],
    }
    return {
        profile: fresh,
        file: path.join(directory, slug(fresh.manufacturer), slug(fresh.line), `${fresh.id}.json`),
    }
}

export interface CaptureIngestResult {
    profile: CameraProfile
    file: string
    /** The model the capture's DeviceInfo reports, when it was captured. */
    reportedModel?: string
}

/** Applies a usbmon capture to a profile and writes it under camera-profiles/. */
export async function ingestCapture(
    profileId: string,
    captureFile: string,
    options: {
        address?: { bus: number; address: number }
        index?: Map<string, IndexedProfile>
        profileDirectory?: string
    } = {}
): Promise<CaptureIngestResult> {
    const index = options.index ?? loadProfileIndex()
    const { profile, file } = capturedProfileFor(
        index.get(profileId),
        profileId,
        options.profileDirectory ?? profileDirectory
    )
    applyCapture(captureTarget(profile), captureFile, options.address)
    const problems = validateCameraProfile(profile)
    if (problems.length) throw new Error(`${profile.id} is invalid after ingesting:\n  ${problems.join('\n  ')}`)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
        file,
        await format(JSON.stringify(canonicalOrder(profile)), { parser: 'json', tabWidth: 4, printWidth: 120 })
    )
    return { profile, file, ...(profile.deviceInfo?.model && { reportedModel: profile.deviceInfo.model }) }
}

/**
 * Takes the hardware rows of a run log (*.jsonl) or support matrix (*.json) into the hardware results
 * that `lab:results` and `compat:merge` combine; a run log is also kept for the UI's run history.
 */
/** Imported results are data, never paths or proof of a completed live operation. */
function validateResultRows(document: unknown): SupportMatrix {
    const matrix = document as SupportMatrix
    if (!matrix || !Array.isArray(matrix.rows) || !Number.isFinite(Date.parse(matrix.generatedAt)))
        throw new Error('Result matrix requires rows and a valid original generatedAt')
    for (const row of matrix.rows) {
        if (!row || typeof row.profile !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.profile))
            throw new Error('Result profile must be a safe lowercase kebab-case identifier')
        for (const name of ['manufacturer', 'line', 'model'] as const)
            if (typeof row[name] !== 'string' || !row[name]) throw new Error(`Result row is missing ${name}`)
        if (
            !['hardware', 'captured', 'documented'].includes(row.fidelity) ||
            (row.transport !== undefined && !['usb', 'ptp-ip'].includes(row.transport))
        )
            throw new Error('Invalid result tier or transport')
        if (!row.results || typeof row.results !== 'object' || Array.isArray(row.results))
            throw new Error('Invalid capability results')
        for (const result of Object.values(row.results)) {
            if (
                !result ||
                !['pass', 'fail', 'no-data', 'unsupported'].includes(result.status) ||
                typeof result.detail !== 'string'
            )
                throw new Error('Invalid capability status or detail')
        }
        if (
            (row.firmware !== undefined && typeof row.firmware !== 'string') ||
            (row.host !== undefined && typeof row.host !== 'string')
        )
            throw new Error('Invalid result firmware or host')
        if (
            row.usb !== undefined &&
            (!Array.isArray(row.usb) ||
                row.usb.some(usb => typeof usb !== 'string' || !/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(usb)))
        )
            throw new Error('Invalid result USB identity')
        if (row.source && !Number.isFinite(Date.parse(row.source.generatedAt)))
            throw new Error('Invalid original result source time')
    }
    return matrix
}

export function ingestResults(
    file: string,
    options: { hardwareDirectory?: string; runsDirectory?: string } = {}
): { rows: SupportMatrixRow[]; written: string[] } {
    const text = readFileSync(file, 'utf8')
    let matrix: SupportMatrix
    let progressCopy: string | undefined
    if (file.endsWith('.jsonl')) {
        const events = parseProgress(text)
        const start = events.find(event => event.type === 'run-start')
        if (!start) throw new Error(`${file} is not a compatibility run log`)
        if (events.some(event => event.runId !== start.runId))
            throw new Error('Run log mixes multiple run IDs; import each run separately')
        const completed = events.filter(event => event.type === 'row-end')
        const rows = rowsFromProgress(events).flatMap(row => {
            const end = [...completed]
                .reverse()
                .find(
                    event =>
                        event.type === 'row-end' &&
                        event.row.profile === row.profile &&
                        (event.row.transport ?? 'usb') === (row.transport ?? 'usb') &&
                        event.row.firmware === row.firmware
                )
            return end ? [{ ...row, source: row.source ?? { generatedAt: end.at } }] : []
        })
        if (!rows.length)
            throw new Error('Run log has no completed rows; partial progress is not a completed hardware result')
        matrix = validateResultRows({ generatedAt: start.at, rows })
        progressCopy = path.join(options.runsDirectory ?? defaultRunsDirectory, path.basename(file))
    } else matrix = validateResultRows(JSON.parse(text))
    const hardware = matrix.rows
        .filter(row => row.fidelity === 'hardware')
        .map(row => ({
            ...row,
            source: row.source ?? {
                generatedAt: matrix.generatedAt,
                ...(matrix.revision && { revision: matrix.revision }),
            },
        }))
    const grouped = new Map<string, SupportMatrixRow[]>()
    for (const row of hardware) {
        const output = path.join(
            options.hardwareDirectory ?? hardwareResultsDirectory,
            hardwareMatrixName(row.profile, row.transport ?? 'usb')
        )
        const previous = existsSync(output) ? validateResultRows(JSON.parse(readFileSync(output, 'utf8'))) : undefined
        const priorRows =
            previous?.rows
                .filter(existing => existing.fidelity === 'hardware')
                .map(existing => ({
                    ...existing,
                    source: existing.source ?? {
                        generatedAt: previous.generatedAt,
                        ...(previous.revision && { revision: previous.revision }),
                    },
                })) ?? []
        const existing = grouped.get(output) ?? priorRows
        if (!existing.some(previous => JSON.stringify(previous) === JSON.stringify(row))) existing.push(row)
        grouped.set(output, existing)
    }
    const written: string[] = []
    for (const [output, rows] of grouped) {
        writeMatrix(output, rows)
        written.push(output)
    }
    if (progressCopy && path.resolve(progressCopy) !== path.resolve(file)) {
        mkdirSync(path.dirname(progressCopy), { recursive: true })
        copyFileSync(file, progressCopy)
    }
    return { rows: hardware, written }
}
