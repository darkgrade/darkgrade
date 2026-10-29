import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { describe, expect, it } from 'vitest'

function container(length: number, type = 2, code = 0x1001): Uint8Array {
    const bytes = new Uint8Array(length).fill(0x5a)
    const header = new DataView(bytes.buffer)
    header.setUint32(0, length, true)
    header.setUint16(4, type, true)
    header.setUint16(6, code, true)
    header.setUint32(8, 7, true)
    return bytes
}

function transportWithPackets(packets: Uint8Array[], maxBulkReadBytes?: number) {
    const reads: number[] = []
    const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }), {
        maxBulkReadBytes,
    })
    Object.assign(transport, {
        connected: true,
        endpoints: { bulkIn: { endpointNumber: 1 } },
        device: {
            transferIn: async (_endpoint: number, length: number) => {
                reads.push(length)
                const packet = packets[0]
                if (!packet) throw new Error('Read beyond the supplied PTP containers')
                const bytes = packet.slice(0, length)
                if (bytes.length === packet.length) packets.shift()
                else packets[0] = packet.slice(length)
                return { status: 'ok', data: new DataView(bytes.buffer) }
            },
        },
    })
    return { transport, reads }
}

describe('USB capture-sized bulk reads', () => {
    it('reassembles large datasets without consuming the following response', async () => {
        const data = container(65_537)
        const response = container(12, 3, 0x2001)
        const { transport, reads } = transportWithPackets([data, response], 16_384)

        expect(await transport.receive(262_144, 1, 7)).toEqual(data)
        expect(reads).toEqual([16_384, 16_384, 16_384, 16_384, 1])
        expect(await transport.receive(512, 1, 7)).toEqual(response)
    })

    it('returns small camera datasets from one bounded read', async () => {
        const data = container(551)
        const { transport, reads } = transportWithPackets([data], 16_384)
        expect(await transport.receive(262_144, 1, 7)).toEqual(data)
        expect(reads).toEqual([16_384])
    })

    it('preserves full-size reads when capture mode is not requested', async () => {
        const data = container(65_537)
        const { transport, reads } = transportWithPackets([data])
        expect(await transport.receive(262_144, 1, 7)).toEqual(data)
        expect(reads).toEqual([262_144])
    })

    it('accepts the terminating zero-length packet after an aligned data phase', async () => {
        const data = container(32_768)
        const response = container(12, 3, 0x2001)
        const { transport } = transportWithPackets([data, new Uint8Array(), response], 16_384)
        expect(await transport.receive(262_144, 1, 7)).toEqual(data)
        expect(await transport.receive(512, 1, 7)).toEqual(response)
    })

    it('does not allocate or drain beyond the caller’s receive limit', async () => {
        const { transport, reads } = transportWithPackets([container(65_537)], 16_384)
        await expect(transport.receive(32_768, 1, 7)).rejects.toThrow('exceeds receive limit')
        expect(reads).toEqual([16_384])
    })

    it.each([0, 512, 1025, NaN, Infinity, 1_073_742_848])('rejects invalid read limits: %s', limit => {
        expect(() => transportWithPackets([], limit)).toThrow('maxBulkReadBytes')
    })

    it('rejects a stalled or empty remainder instead of returning an incomplete dataset', async () => {
        const data = container(20_000)
        const { transport } = transportWithPackets([data.slice(0, 16_384), new Uint8Array()], 16_384)
        await expect(transport.receive(262_144, 1, 7)).rejects.toThrow('Bulk IN failed')
    })
})
