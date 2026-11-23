import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'
import { createRecordingBundle } from '@transport/node-recording'
import { openRecordingBundle } from '@transport/recording-storage'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
const encryption = { id: 'fixture-key', key: randomBytes(32) }
const keys = { [encryption.id]: encryption.key }
const provenance = {
    evidence: 'synthetic' as const,
    camera: 'PRIVATE_CAMERA',
    firmware: 'fixture',
    transport: 'usb',
    revision: 'test',
    scenario: 'large transfer fixture',
    contributors: [{ name: 'PRIVATE_AUTHOR', role: 'test fixture' }],
    sources: [],
    limitations: [],
}
const data = Buffer.from('PRIVATE_IMAGE_AND_METADATA'.repeat(10000))
const source: TransportInterface = {
    connect: async () => {},
    disconnect: async () => {},
    send: async () => {},
    receive: async () => data,
    classRequestReset: async () => {},
    isConnected: () => true,
    isLittleEndian: () => true,
    getType: () => TransportType.USB,
}
describe('encrypted private recording bundle', () => {
    it('encrypts blobs, journal and provenance, retains attribution, and verifies a finalized bundle', async () => {
        const root = await mkdtemp(join(tmpdir(), 'darkgrade-recording-'))
        try {
            const directory = join(root, 'capture')
            const capture = await createRecordingBundle(source, directory, provenance, encryption)
            await capture.transport.receive(data.length, 1, 7)
            await capture.transport.receive(data.length, 1, 8)
            await capture.transport.disconnect()
            const finished = capture.finish()
            await expect(capture.finish()).rejects.toThrow('in progress')
            expect(await finished).toMatchObject({ complete: true, bytes: data.length * 2 })
            const outer = JSON.parse(await readFile(join(directory, 'recording.json'), 'utf8'))
            expect(outer.schema).toBe('darkgrade.recording-bundle/v2')
            expect(outer.files).toHaveLength(4) // one shared encrypted blob, trace, metadata, journal
            for (const file of outer.files) {
                const bytes = await readFile(join(directory, file.path))
                expect(bytes.toString()).not.toContain('PRIVATE_')
                expect((await stat(join(directory, file.path))).mode & 0o777).toBe(0o600)
            }
            const opened = await openRecordingBundle(directory, keys)
            expect(opened.manifest.camera).toBe('PRIVATE_CAMERA')
            const trace = JSON.parse((await opened.read('trace.json', 16 * 1024 * 1024)).toString())
            expect(trace.entries[0].payload.bytes).toBe(data.length)
            expect(trace.entries[0].transactionId).toBe(7)
            await expect(openRecordingBundle(directory)).rejects.toThrow('key unavailable')
            await expect(openRecordingBundle(directory, { 'fixture-key': randomBytes(32) })).rejects.toThrow()
            await expect(capture.finish()).rejects.toThrow('finalized')
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
    it('recovers durable entries before finish and ignores a torn final journal row without claiming completeness', async () => {
        const root = await mkdtemp(join(tmpdir(), 'darkgrade-recording-crash-')),
            directory = join(root, 'capture')
        try {
            const capture = await createRecordingBundle(source, directory, provenance, encryption)
            await capture.transport.receive(data.length, 1, 7)
            await vi.waitFor(async () => {
                const journal = await readFile(join(directory, 'journal.ndjson'), 'utf8')
                expect(journal.split('\n')).toHaveLength(3)
            })
            await writeFile(join(directory, 'journal.ndjson'), 'torn-final-row', { flag: 'a' })
            const opened = await openRecordingBundle(directory, keys)
            expect(opened.manifest.complete).toBe(false)
            expect(opened.manifest.contributors).toEqual(provenance.contributors)
            const trace = JSON.parse((await opened.read('trace.json', 16 * 1024 * 1024)).toString())
            expect(trace.entries).toHaveLength(1)
            const blob = opened.manifest.files.find((file: any) => file.path.startsWith('blobs/'))
            expect(await opened.read(blob.path, blob.bytes)).toEqual(data)
            const journal = await readFile(join(directory, 'journal.ndjson'), 'utf8')
            const rows = journal.split('\n')
            rows[0] = (rows[0][0] === 'A' ? 'B' : 'A') + rows[0].slice(1)
            await writeFile(join(directory, 'journal.ndjson'), rows.join('\n'))
            await expect(openRecordingBundle(directory, keys)).rejects.toThrow()
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
    it('refuses missing encryption and oversized provenance before creating a recording', async () => {
        await expect(
            createRecordingBundle(source, '/unused', provenance, { id: 'fixture', key: new Uint8Array(3) })
        ).rejects.toThrow('32-byte')
    })
})
