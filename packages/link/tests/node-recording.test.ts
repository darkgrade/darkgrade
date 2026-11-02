import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createRecordingBundle } from '@transport/node-recording'
import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'

describe('private recording bundle', () => {
    it('writes attributable immutable blobs and a completion manifest usable by archive workers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'darkgrade-recording-'))
        const data = new Uint8Array(2_000_000).fill(91)
        const source: TransportInterface = {
            connect: async () => {}, disconnect: async () => {}, send: async () => {},
            receive: async () => data, classRequestReset: async () => {},
            isConnected: () => true, isLittleEndian: () => true, getType: () => TransportType.USB,
        }
        try {
            const directory = join(root, 'capture')
            const capture = await createRecordingBundle(source, directory, {
                evidence: 'synthetic', camera: 'test', firmware: 'fixture', transport: 'usb', revision: 'test',
                scenario: 'large transfer fixture', contributors: [{ name: 'Darkgrade', role: 'test fixture' }],
                sources: [], limitations: ['Generated test data, not a physical camera'],
            })
            await capture.transport.receive(data.length, 1, 7)
            await capture.transport.receive(data.length, 1, 8)
            await capture.transport.disconnect()
            expect(await capture.finish()).toMatchObject({ complete: true, bytes: data.length * 2 })
            const bundle = JSON.parse(await readFile(join(directory, 'recording.json'), 'utf8'))
            expect(bundle.files).toHaveLength(2) // shared payload and trace
            expect(bundle.evidence).toBe('synthetic')
            for (const file of bundle.files) {
                const contents = await readFile(join(directory, file.path))
                expect(contents.length).toBe(file.bytes)
                expect(createHash('sha256').update(contents).digest('hex')).toBe(file.sha256)
                expect((await stat(join(directory, file.path))).mode & 0o777).toBe(0o600)
            }
            const trace = JSON.parse(await readFile(join(directory, 'trace.json'), 'utf8'))
            expect(trace.entries[0].payload.bytes).toBe(data.length)
            expect(trace.entries[0].transactionId).toBe(7)
            await expect(capture.finish()).rejects.toThrow('finalized')
        } finally { await rm(root, { recursive: true, force: true }) }
    })
})
