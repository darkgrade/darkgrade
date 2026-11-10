import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { lstat, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface RecordingKey {
    id: string
    key: Uint8Array
}
export type RecordingKeys = Record<string, Uint8Array>
export const recordingHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
export function validateRecordingKey(key: RecordingKey) {
    if (!key || !/^[A-Za-z0-9_-]{1,80}$/.test(key.id) || key.key?.byteLength !== 32)
        throw new Error('Recording requires an external 32-byte AES key and key ID')
}
/** Key material must be supplied by the host/secret store, never written into the bundle. */
export function recordingKeyFromEnvironment(): RecordingKey {
    const encoded = process.env.DARKGRADE_RECORDING_KEY ?? ''
    const key = Buffer.from(encoded, 'base64')
    if (key.toString('base64') !== encoded) throw new Error('Recording key must use canonical base64')
    const result = { id: process.env.DARKGRADE_RECORDING_KEY_ID ?? '', key }
    validateRecordingKey(result)
    return result
}
export function encryptRecording(bytes: Uint8Array, key: Uint8Array, associatedData: string) {
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(Buffer.from(associatedData))
    const body = Buffer.concat([cipher.update(bytes), cipher.final()])
    return Buffer.concat([nonce, cipher.getAuthTag(), body])
}
export function decryptRecording(bytes: Uint8Array, key: Uint8Array, associatedData: string) {
    if (bytes.length < 28) throw new Error('Truncated encrypted recording')
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
    decipher.setAAD(Buffer.from(associatedData))
    decipher.setAuthTag(bytes.subarray(12, 28))
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
}
export async function durableRecordingWrite(path: string, bytes: Uint8Array) {
    const temporary = `${path}.${randomBytes(12).toString('hex')}.tmp`
    try {
        const file = await open(temporary, 'wx', 0o600)
        try {
            await file.writeFile(bytes)
            await file.sync()
        } finally {
            await file.close()
        }
        await rename(temporary, path)
        const directory = await open(dirname(path), 'r')
        try {
            await directory.sync()
        } finally {
            await directory.close()
        }
    } finally {
        await rm(temporary, { force: true })
    }
}
export async function boundedRecordingFile(directory: string, filename: string, maximum: number) {
    if (!/^(recording\.json|journal\.ndjson|metadata\.enc|trace\.enc|trace\.json|blobs\/[a-f0-9]{64})$/.test(filename))
        throw new Error('Invalid recording file reference')
    const info = await lstat(join(directory, filename))
    if (!info.isFile() || info.size > maximum) throw new Error('Invalid or oversized recording file')
    const bytes = await readFile(join(directory, filename))
    if (bytes.length > maximum) throw new Error('Recording file changed during inspection')
    return bytes
}
/** Recover durable entries without writing plaintext or treating an interrupted run as complete. */
export async function openRecordingBundle(directory: string, keys?: RecordingKeys) {
    if (!(await lstat(directory)).isDirectory() || !(await lstat(join(directory, 'blobs'))).isDirectory())
        throw new Error('Recording directories must not be links')
    const outerBytes = await boundedRecordingFile(directory, 'recording.json', 8 * 1024 * 1024)
    const outer = JSON.parse(outerBytes.toString('utf8'))
    if (outer.schema === 'darkgrade.recording-bundle/v1')
        return {
            manifest: outer,
            manifestBytes: outerBytes,
            read: (filename: string, maximum: number) => boundedRecordingFile(directory, filename, maximum),
        }
    if (
        outer.schema !== 'darkgrade.recording-bundle/v2' ||
        !/^[a-f0-9]{32}$/.test(outer.bundleId) ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(outer.keyId) ||
        outer.encryption !== 'AES-256-GCM'
    )
        throw new Error('Invalid encrypted recording manifest')
    const key = keys && Object.hasOwn(keys, outer.keyId) ? keys[outer.keyId] : undefined
    if (!key || key.length !== 32) throw new Error('Recording decryption key unavailable')
    const decrypt = (bytes: Uint8Array, purpose: string) => decryptRecording(bytes, key, `${outer.bundleId}:${purpose}`)
    let manifest: any, trace: Buffer | undefined
    if (outer.state === 'complete') {
        if (!Array.isArray(outer.files) || outer.files.length > 20002) throw new Error('Invalid encrypted file index')
        let total = 0
        const paths = new Set<string>()
        for (const file of outer.files) {
            if (
                paths.has(file.path) ||
                !/^[a-f0-9]{64}$/.test(file.sha256) ||
                !Number.isSafeInteger(file.bytes) ||
                file.bytes < 0
            )
                throw new Error('Invalid recording file reference')
            paths.add(file.path)
            total += file.bytes
            if (total > 512 * 1024 * 1024) throw new Error('Recording exceeds inspection bound')
            const bytes = await boundedRecordingFile(directory, file.path, file.bytes)
            if (bytes.length !== file.bytes || recordingHash(bytes) !== file.sha256)
                throw new Error('Recording integrity mismatch')
        }
        if (!paths.has('metadata.enc') || !paths.has('trace.enc') || !paths.has('journal.ndjson'))
            throw new Error('Missing encrypted file index')
        manifest = JSON.parse(
            decrypt(await boundedRecordingFile(directory, 'metadata.enc', 16 * 1024 * 1024), 'metadata').toString(
                'utf8'
            )
        )
        if (!Array.isArray(manifest.files) || manifest.files.some((file: any) => !paths.has(file.encryptedPath)))
            throw new Error('Missing encrypted recording reference')
    } else if (outer.state === 'recording') {
        const journal = await boundedRecordingFile(directory, 'journal.ndjson', 64 * 1024 * 1024)
        const lines = journal.toString('utf8').split('\n')
        lines.pop() // Only newline-committed records are recoverable after a torn write.
        if (!lines.length || lines.length > 20001) throw new Error('Invalid recording journal')
        const records = lines.map((line, index) =>
            JSON.parse(decrypt(Buffer.from(line, 'base64'), `journal:${index}`).toString('utf8'))
        )
        const header = records.shift()
        const entries = records.map(record => record.entry).sort((left, right) => left.sequence - right.sequence)
        const files = new Map<string, any>()
        for (const record of records) if (record.file) files.set(record.file.path, record.file)
        trace = Buffer.from(
            JSON.stringify({
                schema: 'darkgrade.transport-recording/v1',
                complete: false,
                transportType: header.transportType,
                littleEndian: header.littleEndian,
                droppedEntries: 0,
                entries,
            })
        )
        files.set('trace.json', { path: 'trace.json', bytes: trace.length, sha256: recordingHash(trace) })
        manifest = {
            schema: 'darkgrade.recording-bundle/v1',
            ...header.metadata,
            recordedAt: header.recordedAt,
            complete: false,
            files: [...files.values()],
            limitations: [
                ...header.metadata.limitations,
                'Interrupted recording: durable entries only; queued/in-flight work may be missing',
            ],
        }
    } else throw new Error('Invalid recording state')
    return {
        manifest,
        manifestBytes: outerBytes,
        read: async (filename: string, maximum: number) => {
            if (filename === 'trace.json' && trace) return trace
            const file = manifest.files.find((file: any) => file.path === filename)
            if (
                !file ||
                typeof file.encryptedPath !== 'string' ||
                !Number.isSafeInteger(file.bytes) ||
                file.bytes < 0 ||
                file.bytes > maximum
            )
                throw new Error('Invalid encrypted recording reference')
            const encrypted = await boundedRecordingFile(directory, file.encryptedPath, maximum + 28)
            if (file.encryptedPath.startsWith('blobs/') && file.encryptedPath !== `blobs/${recordingHash(encrypted)}`)
                throw new Error('Recording integrity mismatch')
            return decrypt(encrypted, filename)
        },
    }
}
