import { createNikonRegistry } from '@ptp/registry'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
import { describe, expect, it } from 'vitest'

// Independently written Z6III SDK command reference (rev 2, section 6.2.2.13) framing examples,
// not a camera capture or an encoder round trip.
const records = '020000000140010078563412054002000100000002000000'
const decoded = [
    { code: 0x4001, parameters: [0x12345678] },
    { code: 0x4005, parameters: [1, 2] },
]
const codec = new NikonEventDataCodec(createNikonRegistry(true))

function bytes(hex: string): Uint8Array {
    return Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
}

describe('Nikon GetEventEx data codec', () => {
    it('decodes and encodes independent multi-parameter event records', () => {
        expect(codec.decode(bytes(records))).toEqual({ value: decoded, bytesRead: 24 })
        expect(codec.encode(decoded)).toEqual(bytes(records))
        expect(codec.decode(bytes('00000000')).value).toEqual([])
    })

    it('rejects malformed counts, missing words and trailing bytes', () => {
        for (const hex of ['01', 'ffffffff', '010000000140020001000000', '0000000000000000'])
            expect(() => codec.decode(bytes(hex))).toThrow()
        expect(() => codec.encode([{ code: 0x4001, parameters: [-1] }])).toThrow('parameter')
    })

    it('exposes typed retain and drain parameters on GetEventEx', () => {
        const operation = createNikonRegistry(true).operations.GetEventEx
        const keepEvents = operation.operationParameters[0].codec(createNikonRegistry(true))
        expect(operation.code).toBe(0x941c)
        expect(keepEvents.encode('RETAIN')).toEqual(Uint8Array.of(1, 0, 0, 0))
        expect(keepEvents.encode('DRAIN')).toEqual(Uint8Array.of(0, 0, 0, 0))
    })
})
