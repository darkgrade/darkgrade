import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { recordFullTransport, type TransportRecordingEntry } from '@transport/recording-transport'

export interface RecordingProvenance {
    evidence: 'hardware' | 'synthetic'
    camera: string
    firmware: string
    transport: string
    revision: string
    scenario: string
    contributors: { name: string; role: string }[]
    sources: string[]
    limitations: string[]
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** A new private directory of immutable, content-addressed blobs plus attribution. No cloud credentials. */
export async function createRecordingBundle(source: TransportInterface, directory: string, provenance: RecordingProvenance) {
    const metadata: RecordingProvenance = structuredClone(provenance)
    if (!['hardware', 'synthetic'].includes(metadata.evidence) ||
        !metadata.contributors?.length || metadata.contributors.some(person => !person.name?.trim() || !person.role?.trim()))
        throw new Error('Recording requires explicit evidence and contributor attribution')
    for (const field of ['camera', 'firmware', 'transport', 'revision', 'scenario'] as const)
        if (typeof metadata[field] !== 'string' || !metadata[field].trim()) throw new Error(`Missing recording ${field}`)
    if (!Array.isArray(metadata.sources) || !Array.isArray(metadata.limitations))
        throw new Error('Recording sources and limitations must be explicit')
    await mkdir(directory, { mode: 0o700 })
    await mkdir(join(directory, 'blobs'), { mode: 0o700 })
    const recordedAt = new Date().toISOString()
    const entries: (Omit<TransportRecordingEntry, 'bytes'> & { payload?: { sha256: string; bytes: number } })[] = []
    const files = new Map<string, { path: string; sha256: string; bytes: number }>()
    const recording = recordFullTransport(source, {
        maximumEntries: 19_999,
        maximumTotalBytes: 480 * 1024 * 1024, // leave room for trace metadata in a 512 MiB archive
        write: async ({ bytes, ...entry }) => {
            if (!bytes) { entries.push(entry); return }
            const sha256 = digest(bytes)
            const path = `blobs/${sha256}`
            if (!files.has(path)) {
                await writeFile(join(directory, path), bytes, { flag: 'wx', mode: 0o600 })
                files.set(path, { path, sha256, bytes: bytes.length })
            }
            entries.push({ ...entry, payload: { sha256, bytes: bytes.length } })
        },
    })
    let finalized = false
    return {
        transport: recording.transport,
        async finish(observed?: { camera?: string; firmware?: string }) {
            if (finalized) throw new Error('Recording already finalized')
            const status = await recording.finish()
            finalized = true
            for (const field of ['camera', 'firmware'] as const)
                if (observed?.[field]?.trim()) metadata[field] = observed[field]!
            const trace = Buffer.from(JSON.stringify({
                schema: 'darkgrade.transport-recording/v1', ...status,
                transportType: source.getType(), littleEndian: source.isLittleEndian(),
                // Sequence is operation initiation order. Completion times retain overlapping reads/events.
                entries: entries.sort((left, right) => left.sequence - right.sequence),
            }))
            await writeFile(join(directory, 'trace.json'), trace, { flag: 'wx', mode: 0o600 })
            files.set('trace.json', { path: 'trace.json', sha256: digest(trace), bytes: trace.length })
            const bundle = {
                schema: 'darkgrade.recording-bundle/v1', ...metadata, recordedAt,
                complete: status.complete,
                limitations: [...metadata.limitations, ...(status.error ? [status.error] : [])],
                files: [...files.values()],
            }
            await writeFile(join(directory, 'recording.json'), JSON.stringify(bundle), { flag: 'wx', mode: 0o600 })
            return { complete: status.complete, entries: status.entries, bytes: status.totalBytes, droppedEntries: status.droppedEntries }
        },
    }
}
