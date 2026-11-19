import { observeTransport, type CameraTransport } from '@contribute/observe'
import { validateContribution, type DiagnosticEntry } from '@contribute/schema'
import { describe, expect, it } from 'vitest'

function packet(kind: number, code: number, transaction: number, parameter?: number): Uint8Array {
    const bytes = new Uint8Array(parameter === undefined ? 12 : 16)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, kind, true)
    view.setUint16(6, code, true)
    view.setUint32(8, transaction, true)
    if (parameter !== undefined) view.setUint32(12, parameter, true)
    return bytes
}

function fixture(manufacturer = 'Sony Corporation') {
    const entries: DiagnosticEntry[] = []
    const incoming: Uint8Array[] = []
    let generation = 0
    const source: CameraTransport = {
        connect: async () => {},
        disconnect: async () => {},
        send: async () => {},
        receive: async () => incoming.shift()!,
        classRequestReset: async () => {},
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => 'usb',
    }
    const observed = observeTransport(
        source,
        () => true,
        entry => entries.push(entry),
        () => generation,
        () => ({ manufacturer })
    )
    return { entries, incoming, source, observed, nextGeneration: () => generation++ }
}

describe('Sony telemetry transaction context', () => {
    it('distinguishes live-view retry from a real card refusal while retaining both response codes', async () => {
        const f = fixture()
        await f.observed.transport.send(packet(1, 0x1009, 51, 0xffffc002), 1, 51)
        f.incoming.push(packet(3, 0x200f, 51))
        await f.observed.transport.receive(12, 1, 51)
        await f.observed.transport.send(packet(1, 0x923c, 52), 1, 52)
        f.incoming.push(packet(3, 0x200f, 52))
        await f.observed.transport.receive(12, 1, 52)
        expect(f.entries.filter(entry => entry.kind === 'response')).toMatchObject([
            { code: 0x200f, operation: 'sony_live_view_frame', transactionId: 51 },
            { code: 0x200f, operation: 'sony_card_index', transactionId: 52 },
        ])
        expect(JSON.stringify(f.entries)).not.toMatch(/4294950914|0xffffc002|parameters|payload|filename/)
        validateContribution({
            schema: 'darkgrade.diagnostics/v1',
            disclosure: 'protocol-metadata-only/v1',
            id: crypto.randomUUID(),
            camera: {
                manufacturer: 'Sony',
                model: 'ILCE-7M5',
                firmware: '1.00',
                revision: '1234567',
                dirty: false,
                transport: 'usb',
                backend: 'ptp',
                evidence: 'synthetic',
            },
            entries: f.entries,
            droppedEntries: 0,
        })
    })

    it('keeps transactions separate and forgets their labels after the final response', async () => {
        const f = fixture()
        await f.observed.transport.send(packet(1, 0x1009, 1, 0xffffc002), 1, 1)
        await f.observed.transport.send(packet(1, 0x1005, 2, 123), 1, 2)
        f.incoming.push(packet(2, 0x1005, 2), packet(3, 0x200f, 2), packet(3, 0x2001, 1), packet(3, 0x200f, 1))
        for (let i = 0; i < 4; i++) await f.observed.transport.receive(12, 1, 0)
        expect(f.entries.slice(-4).map(entry => entry.operation)).toEqual([
            'get_storage_info',
            'get_storage_info',
            'sony_live_view_frame',
            undefined,
        ])
    })

    it('does not label an ordinary card object or another vendor as a Sony live frame', async () => {
        for (const [vendor, handle] of [
            ['Canon', 0xffffc002],
            ['Sony', 7],
        ] as const) {
            const f = fixture(vendor)
            await f.observed.transport.send(packet(1, 0x1009, 1, handle), 1, 1)
            expect(f.entries[0].operation).toBe('get_object')
        }
    })

    it('cannot reuse a label across consent changes or reconnects', async () => {
        for (const reset of ['consent', 'connect'] as const) {
            const f = fixture()
            await f.observed.transport.send(packet(1, 0x1009, 1, 0xffffc002), 1, 1)
            if (reset === 'consent') f.nextGeneration()
            else await f.observed.transport.connect()
            f.incoming.push(packet(3, 0x200f, 1))
            await f.observed.transport.receive(12, 1, 1)
            expect(f.entries.at(-1)?.operation).toBeUndefined()
        }
    })

    it('does not apply an old label when an unknown command reuses the transaction ID', async () => {
        const f = fixture()
        await f.observed.transport.send(packet(1, 0x1009, 1, 0xffffc002), 1, 1)
        await f.observed.transport.send(packet(1, 0x9207, 1, 123), 1, 1)
        f.incoming.push(packet(3, 0x200f, 1))
        await f.observed.transport.receive(12, 1, 1)
        expect(f.entries.at(-1)?.operation).toBeUndefined()
    })
})
