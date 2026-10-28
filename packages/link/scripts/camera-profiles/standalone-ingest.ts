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
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
export function ingestResults(
    file: string,
    options: { hardwareDirectory?: string; runsDirectory?: string } = {}
): { rows: SupportMatrixRow[]; written: string[] } {
    const text = readFileSync(file, 'utf8')
    let rows: SupportMatrixRow[]
    if (file.endsWith('.jsonl')) {
        const events = parseProgress(text)
        if (!events.some(event => event.type === 'run-start')) throw new Error(`${file} is not a compatibility run log`)
        rows = rowsFromProgress(events)
        const runsDirectory = options.runsDirectory ?? defaultRunsDirectory
        mkdirSync(runsDirectory, { recursive: true })
        const copy = path.join(runsDirectory, path.basename(file))
        if (path.resolve(copy) !== path.resolve(file)) copyFileSync(file, copy)
    } else {
        rows = (JSON.parse(text) as SupportMatrix).rows
    }
    const hardware = rows.filter(row => row.fidelity === 'hardware')
    const written = hardware.map(row => {
        const output = path.join(
            options.hardwareDirectory ?? hardwareResultsDirectory,
            hardwareMatrixName(row.profile, row.transport ?? 'usb')
        )
        writeMatrix(output, [row])
        return output
    })
    return { rows: hardware, written }
}
