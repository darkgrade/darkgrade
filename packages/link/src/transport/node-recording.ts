import type { TransportInterface } from '@transport/interfaces/transport.interface'
import {
    durableRecordingWrite,
    encryptRecording,
    recordingKeyFromEnvironment,
    validateRecordingKey,
    type RecordingKey,
} from '@transport/recording-storage'
import { recordFullTransport, type TransportRecordingEntry } from '@transport/recording-transport'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
export async function createRecordingBundle(
    source: TransportInterface,
    directory: string,
    provenance: RecordingProvenance,
    encryption: RecordingKey = recordingKeyFromEnvironment()
) {
    validateRecordingKey(encryption)
    const key = Uint8Array.from(encryption.key),
        bundleId = randomBytes(16).toString('hex')
    const encrypt = (bytes: Uint8Array, purpose: string) => encryptRecording(bytes, key, `${bundleId}:${purpose}`)
    const metadata: RecordingProvenance = structuredClone(provenance)
    if (
        !['hardware', 'synthetic'].includes(metadata.evidence) ||
        !metadata.contributors?.length ||
        metadata.contributors.some(person => !person.name?.trim() || !person.role?.trim())
    )
        throw new Error('Recording requires explicit evidence and contributor attribution')
    for (const field of ['camera', 'firmware', 'transport', 'revision', 'scenario'] as const)
        if (typeof metadata[field] !== 'string' || !metadata[field].trim())
            throw new Error(`Missing recording ${field}`)
    if (!Array.isArray(metadata.sources) || !Array.isArray(metadata.limitations))
        throw new Error('Recording sources and limitations must be explicit')
    if (Buffer.byteLength(JSON.stringify(metadata)) > 64 * 1024) throw new Error('Recording provenance exceeds limit')
    await mkdir(directory, { mode: 0o700 })
    await mkdir(join(directory, 'blobs'), { mode: 0o700 })
    const recordedAt = new Date().toISOString()
    const outer = {
        schema: 'darkgrade.recording-bundle/v2',
        bundleId,
        keyId: encryption.id,
        encryption: 'AES-256-GCM',
        state: 'recording',
        complete: false,
    }
    let journalSequence = 0,
        journalBytes = 0
    const journal = async (record: unknown) => {
        const row = encrypt(Buffer.from(JSON.stringify(record)), `journal:${journalSequence}`).toString('base64') + '\n'
        if (journalBytes + Buffer.byteLength(row) > 64 * 1024 * 1024) throw new Error('Recording journal exceeds limit')
        const file = await open(join(directory, 'journal.ndjson'), 'a', 0o600)
        try {
            await file.writeFile(row)
            journalSequence++
            journalBytes += Buffer.byteLength(row)
            await file.sync()
        } finally {
            await file.close()
        }
    }
    await journal({ metadata, recordedAt, transportType: source.getType(), littleEndian: source.isLittleEndian() })
    await durableRecordingWrite(join(directory, 'recording.json'), Buffer.from(JSON.stringify(outer)))
    const entries: (Omit<TransportRecordingEntry, 'bytes'> & { payload?: { sha256: string; bytes: number } })[] = []
    const files = new Map<string, { path: string; sha256: string; bytes: number; encryptedPath: string }>()
    const recording = recordFullTransport(source, {
        maximumEntries: 19_999,
        maximumTotalBytes: 384 * 1024 * 1024, // encrypted journal and manifests also fit inside a 512 MiB archive
        write: async ({ bytes, ...entry }) => {
            if (!bytes) {
                await journal({ entry })
                entries.push(entry)
                return
            }
            const sha256 = digest(bytes)
            const path = `blobs/${sha256}`
            if (!files.has(path)) {
                const encrypted = encrypt(bytes, path),
                    encryptedPath = `blobs/${digest(encrypted)}`
                await durableRecordingWrite(join(directory, encryptedPath), encrypted)
                files.set(path, { path, sha256, bytes: bytes.length, encryptedPath })
            }
            const saved = { ...entry, payload: { sha256, bytes: bytes.length } }
            await journal({ entry: saved, file: files.get(path) })
            entries.push(saved)
        },
    })
    let finalized = false,
        finalizing = false
    return {
        transport: recording.transport,
        async finish(observed?: { camera?: string; firmware?: string }) {
            if (finalized) throw new Error('Recording already finalized')
            if (finalizing) throw new Error('Recording finalization in progress')
            finalizing = true
            try {
                const status = await recording.finish()
                for (const field of ['camera', 'firmware'] as const)
                    if (observed?.[field]?.trim()) metadata[field] = observed[field]!
                if (Buffer.byteLength(JSON.stringify(metadata)) > 64 * 1024)
                    throw new Error('Recording provenance exceeds limit')
                const trace = Buffer.from(
                    JSON.stringify({
                        schema: 'darkgrade.transport-recording/v1',
                        ...status,
                        transportType: source.getType(),
                        littleEndian: source.isLittleEndian(),
                        // Sequence is operation initiation order. Completion times retain overlapping reads/events.
                        entries: entries.sort((left, right) => left.sequence - right.sequence),
                    })
                )
                if (trace.length > 16 * 1024 * 1024) throw new Error('Recording trace exceeds limit')
                await durableRecordingWrite(join(directory, 'trace.enc'), encrypt(trace, 'trace.json'))
                files.set('trace.json', {
                    path: 'trace.json',
                    sha256: digest(trace),
                    bytes: trace.length,
                    encryptedPath: 'trace.enc',
                })
                const bundle = {
                    schema: 'darkgrade.recording-bundle/v1',
                    ...metadata,
                    recordedAt,
                    complete: status.complete,
                    limitations: [...metadata.limitations, ...(status.error ? [status.error] : [])],
                    files: [...files.values()],
                }
                await durableRecordingWrite(
                    join(directory, 'metadata.enc'),
                    encrypt(Buffer.from(JSON.stringify(bundle)), 'metadata')
                )
                const encryptedFiles = []
                for (const path of [
                    'metadata.enc',
                    'journal.ndjson',
                    ...[...files.values()].map(file => file.encryptedPath),
                ]) {
                    const bytes = await readFile(join(directory, path))
                    encryptedFiles.push({ path, sha256: digest(bytes), bytes: bytes.length })
                }
                await durableRecordingWrite(
                    join(directory, 'recording.json'),
                    Buffer.from(
                        JSON.stringify({
                            ...outer,
                            state: 'complete',
                            complete: status.complete,
                            files: encryptedFiles,
                        })
                    )
                )
                finalized = true
                key.fill(0)
                return {
                    complete: status.complete,
                    entries: status.entries,
                    bytes: status.totalBytes,
                    droppedEntries: status.droppedEntries,
                }
            } finally {
                finalizing = false
            }
        },
    }
}
