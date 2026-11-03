import { TransportType, type TransportInterface } from '@transport/interfaces/transport.interface'
import { createRecordingBundle } from '@transport/node-recording'
import { inspectRecording } from '@transport/recording-inspection'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

function container(kind: number, value: number, payload = Buffer.alloc(0)) {
    const bytes = Buffer.alloc(12 + payload.length)
    bytes.writeUInt32LE(bytes.length)
    bytes.writeUInt16LE(kind, 4)
    bytes.writeUInt16LE(value, 6)
    bytes.writeUInt32LE(1, 8)
    payload.copy(bytes, 12)
    return bytes
}

it('inspects fragmented private transfers, verifies all hashes and preserves failure/attribution without exporting bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recording-inspection-')),
        directory = join(root, 'capture')
    const encryption = { id: 'fixture', key: randomBytes(32) },
        keys = { fixture: null as any }
    keys.fixture = encryption.key
    const payload = Buffer.from('PRIVATE_IMAGE_AND_METADATA')
    const data = container(2, 0x1009, payload)
    const replies = [data.subarray(0, 7), data.subarray(7, 17), data.subarray(17), container(3, 0x2001)]
    const source: TransportInterface = {
        connect: async () => {},
        disconnect: async () => {},
        classRequestReset: async () => {},
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => TransportType.USB,
        send: async () => {},
        receive: async () => {
            const reply = replies.shift()
            if (!reply) throw new Error('Test failure')
            return reply
        },
    }
    try {
        const recording = await createRecordingBundle(
            source,
            directory,
            {
                evidence: 'synthetic',
                camera: 'Fixture',
                firmware: '1',
                transport: 'usb',
                revision: 'test',
                scenario: 'fragmented-media',
                contributors: [{ name: 'Test author', role: 'fixture' }],
                sources: ['test'],
                limitations: [],
            },
            encryption
        )
        await recording.transport.connect()
        await recording.transport.send(container(1, 0x1009), 1, 1)
        for (let index = 0; index < 4; index++) await recording.transport.receive(100, 1, 1)
        await expect(recording.transport.receive(100, 1, 2)).rejects.toThrow('Test failure')
        await recording.transport.disconnect()
        await recording.finish()
        const report = await inspectRecording(directory, keys)
        expect(report).toMatchObject({
            complete: true,
            failures: 1,
            connections: 1,
            disconnections: 1,
            unframed: 0,
            unfinishedTransactions: 0,
            contributors: [{ name: 'Test author', role: 'fixture' }],
            operations: { '0x1009': { count: 1, responses: { '0x2001': 1 }, dataBytes: payload.length } },
        })
        expect(JSON.stringify(report)).not.toContain('PRIVATE_IMAGE')
        const manifest = JSON.parse(await readFile(join(directory, 'recording.json'), 'utf8'))
        const blob = manifest.files.find((file: { path: string }) => file.path.startsWith('blobs/'))
        await writeFile(join(directory, blob.path), Buffer.alloc(blob.bytes))
        await expect(inspectRecording(directory, keys)).rejects.toThrow('integrity')
        manifest.files[0].path = '../outside'
        await writeFile(join(directory, 'recording.json'), JSON.stringify(manifest))
        await expect(inspectRecording(directory, keys)).rejects.toThrow('reference')
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})
