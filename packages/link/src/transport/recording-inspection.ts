import {createHash} from 'node:crypto'
import {lstat, readFile} from 'node:fs/promises'
import {join} from 'node:path'

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const code = (value: number) => `0x${value.toString(16).padStart(4, '0')}`

async function boundedFile(directory: string, filename: string, maximum: number) {
    const filenamePath = join(directory, filename)
    const info = await lstat(filenamePath)
    if (!info.isFile() || info.size > maximum) throw new Error('Invalid or oversized recording file')
    const bytes = await readFile(filenamePath)
    if (bytes.length > maximum) throw new Error('Recording file changed during inspection')
    return bytes
}

/** Verifies private files and returns only protocol counts, timing and attribution. No media or identities. */
export async function inspectRecording(directory: string) {
    if (!(await lstat(directory)).isDirectory() || !(await lstat(join(directory, 'blobs'))).isDirectory())
        throw new Error('Recording directories must not be links')
    const manifestBytes = await boundedFile(directory, 'recording.json', 8 * 1024 * 1024)
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    if (manifest.schema !== 'darkgrade.recording-bundle/v1' || !Array.isArray(manifest.files) ||
        !manifest.files.length || manifest.files.length > 20000 || typeof manifest.complete !== 'boolean' ||
        !Array.isArray(manifest.contributors) || !manifest.contributors.length || !Array.isArray(manifest.sources))
        throw new Error('Invalid recording manifest')
    const files = new Map<string, {bytes: number; sha256: string}>()
    let totalBytes = 0
    for (const file of manifest.files) {
        if (typeof file.path !== 'string' || !/^(trace\.json|blobs\/[a-f0-9]{64})$/.test(file.path) ||
            !digest(file.sha256) || !integer(file.bytes) || files.has(file.path) ||
            (file.path.startsWith('blobs/') && file.path !== `blobs/${file.sha256}`))
            throw new Error('Invalid recording file reference')
        totalBytes += file.bytes
        if (totalBytes > 512 * 1024 * 1024) throw new Error('Recording exceeds inspection bound')
        files.set(file.path, file)
    }
    const verified = async (filename: string) => {
        const file = files.get(filename)
        if (!file) throw new Error('Recording file is not in the manifest')
        const bytes = await boundedFile(directory, filename, file.bytes)
        if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('Recording integrity mismatch')
        return bytes
    }
    const traceBytes = await verified('trace.json')
    const trace = JSON.parse(traceBytes.toString('utf8'))
    if (trace.schema !== 'darkgrade.transport-recording/v1' || trace.transportType !== 'usb' ||
        trace.littleEndian !== true || !Array.isArray(trace.entries) || trace.entries.length > 20000 ||
        typeof trace.complete !== 'boolean' || !integer(trace.droppedEntries) || !integer(trace.entries?.length))
        throw new Error('Inspection requires a bounded USB transport trace')
    const operations = new Map<string, {count: number; responses: Record<string, number>; dataBytes: number; maximumMilliseconds: number}>()
    const events: Record<string, number> = {}
    const used = new Set(['trace.json'])
    let previous = -1, session = 0, connections = 0, disconnections = 0, failures = 0, unframed = 0
    const pending = new Map<string, {operation: string; started: number}>()
    const streams = new Map<string, {header: Buffer; remaining: number; started: number}>()
    const completed = (direction: string, header: Buffer, started: number, finished: number) => {
        const length = header.readUInt32LE(0), kind = header.readUInt16LE(4), value = header.readUInt16LE(6)
        const key = `${session}:${header.readUInt32LE(8)}`
        if (kind === 1 && direction === 'send') {
            const name = code(value)
            const operation = operations.get(name) ?? {count: 0, responses: {}, dataBytes: 0, maximumMilliseconds: 0}
            operation.count++
            operations.set(name, operation)
            if (pending.has(key)) throw new Error('Ambiguous transaction reuse')
            pending.set(key, {operation: name, started})
        } else if ([2, 3].includes(kind) && pending.has(key)) {
            const request = pending.get(key)!, operation = operations.get(request.operation)!
            if (kind === 2) {
                if (code(value) !== request.operation) throw new Error('Mismatched recorded data operation')
                operation.dataBytes += length - 12
            }
            if (kind === 3) {
                const response = code(value)
                operation.responses[response] = (operation.responses[response] ?? 0) + 1
                operation.maximumMilliseconds = Math.max(operation.maximumMilliseconds, finished - request.started)
                pending.delete(key)
            }
        }
    }
    const consume = (direction: string, bytes: Buffer, started: number, finished: number) => {
        let offset = 0
        while (offset < bytes.length) {
            const stream = streams.get(direction) ?? {header: Buffer.alloc(0), remaining: -1, started}
            streams.set(direction, stream)
            if (stream.header.length < 12) {
                const count = Math.min(12 - stream.header.length, bytes.length - offset)
                stream.header = Buffer.concat([stream.header, bytes.subarray(offset, offset + count)])
                offset += count
                if (stream.header.length < 12) continue
                const length = stream.header.readUInt32LE(0), kind = stream.header.readUInt16LE(4)
                if (length < 12 || length > 512 * 1024 * 1024 || kind < 1 || kind > 4)
                    throw new Error('Invalid recorded USB container')
                stream.remaining = length - 12
            }
            const count = Math.min(stream.remaining, bytes.length - offset)
            stream.remaining -= count
            offset += count
            if (stream.remaining === 0) {
                completed(direction, stream.header, stream.started, finished)
                streams.delete(direction)
            }
        }
    }
    for (const entry of trace.entries) {
        if (!integer(entry.sequence) || entry.sequence <= previous ||
            !['connect', 'disconnect', 'reset', 'send', 'receive', 'event'].includes(entry.kind) ||
            !Number.isFinite(entry.startedMilliseconds) || !Number.isFinite(entry.finishedMilliseconds) ||
            entry.startedMilliseconds < 0 || entry.finishedMilliseconds < entry.startedMilliseconds)
            throw new Error('Invalid recording event order or timing')
        previous = entry.sequence
        if (entry.failed) failures++
        if (['connect', 'disconnect', 'reset'].includes(entry.kind)) {
            unframed += streams.size
            streams.clear()
        }
        if (entry.kind === 'connect') {session++; if (!entry.failed) connections++}
        if (entry.kind === 'disconnect' && !entry.failed) disconnections++
        if (entry.kind === 'event') {
            if (!integer(entry.event?.code) || entry.event.code > 0xffff) throw new Error('Invalid recorded event')
            const name = code(entry.event.code)
            events[name] = (events[name] ?? 0) + 1
        }
        if (!entry.payload) continue
        if (!digest(entry.payload.sha256) || !integer(entry.payload.bytes)) throw new Error('Invalid trace payload')
        const filename = `blobs/${entry.payload.sha256}`
        const bytes = await verified(filename)
        used.add(filename)
        if (bytes.length !== entry.payload.bytes) throw new Error('Payload length mismatch')
        if (entry.failed) continue
        if (!['send', 'receive'].includes(entry.kind)) throw new Error('Payload attached to a non-transfer event')
        consume(entry.kind, bytes, entry.startedMilliseconds, entry.finishedMilliseconds)
    }
    // Verify even blobs unused by the trace, so integrity never depends on what the caller inspects.
    for (const filename of files.keys()) if (!used.has(filename)) await verified(filename)
    return {
        schema: 'darkgrade.recording-inspection/v1', manifestSha256: hash(manifestBytes), traceSha256: hash(traceBytes),
        complete: manifest.complete && trace.complete && trace.droppedEntries === 0,
        camera: manifest.camera, firmware: manifest.firmware, revision: manifest.revision,
        recordedAt: manifest.recordedAt, scenario: manifest.scenario, contributors: manifest.contributors, sources: manifest.sources,
        bytes: totalBytes, entries: trace.entries.length, connections, disconnections, failures, unframed: unframed + streams.size,
        unfinishedTransactions: pending.size, events, operations: Object.fromEntries(operations),
        scope: 'Hashed private USB transport evidence with reassembled containers. Counts do not establish workflow success or image decoding. Incomplete containers are counted separately.',
    }
}
