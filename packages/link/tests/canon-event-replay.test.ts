import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { createCanonRegistry } from '@ptp/registry'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

const registry = createCanonRegistry(true)
const codec = new CanonEventDataCodec(registry)
const words = (...values: number[]) => {
    const result = new Uint8Array(values.length * 4)
    const view = new DataView(result.buffer)
    values.forEach((value, index) => view.setUint32(index * 4, value, true))
    return result
}
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap(part => [...part]))

describe('Canon polled event replay', () => {
    it('retains opaque and header-only events without swallowing later properties', () => {
        const payload = concat(
            words(8, 0xc18b),
            words(16, 0xc1a5, 0x80000518, 0xaabbccdd),
            words(16, 0xc189, 0xd116, 0x80000518),
            words(8, 0)
        )
        const decoded = codec.decode(payload)
        expect(decoded.bytesRead).toBe(payload.length)
        expect(decoded.value.map(event => event.code)).toEqual([0xc18b, 0xc1a5, 0xc189])
        expect(decoded.value[1].parameters).toEqual([])
        expect(decoded.value[1].rawData).toEqual(words(0x80000518, 0xaabbccdd))
        expect(decoded.value[2].parameters).toEqual([0xd116, 0x80000518])
        payload.fill(0)
        expect(decoded.value[1].rawData).toEqual(words(0x80000518, 0xaabbccdd))
    })

    it('rejects malformed records and incomplete lists instead of publishing partial choices', () => {
        for (const payload of [
            words(4, 0xc189),
            words(8, 0xc189),
            words(16, 0xc18a, 0xd103, 3),
            words(28, 0xc18a, 0xd103, 3, 3, 0x48, 0x50),
            words(24, 0xc18a, 0xd1cd, 3, 1, 100),
            words(24, 0xc18a, 0xd120, 3, 1, 2),
            Uint8Array.of(8, 0, 0),
        ])
            expect(() => codec.decode(payload)).toThrow()
        expect(() => codec.decode(words(8, 0), -1)).toThrow('offset')
        const choices = Array.from({ length: 256 }, (_, index) => index)
        const parsed = codec.decode(words(20 + choices.length * 4, 0xc18a, 0xd103, 3, choices.length, ...choices))
        expect(parsed.value[0].allowedValues).toEqual(choices)
        const unknownType = codec.decode(words(24, 0xc18a, 0xd103, 99, 1, 0x48)).value[0]
        expect(unknownType.allowedValueData).toBeUndefined()
        expect(unknownType.rawData).toEqual(words(0xd103, 99, 1, 0x48))
    })

    it('delivers owned opaque records and replaces an old choice list with the complete empty list', async () => {
        vi.useFakeTimers()
        let connected = false
        const transport = {
            isLittleEndian: () => true,
            isConnected: () => connected,
            connect: async () => {
                connected = true
            },
            disconnect: async () => {
                connected = false
            },
            on: () => undefined,
        } as unknown as TransportInterface
        const camera = new CanonCamera(transport, new Logger({ renderInTerminal: false, captureConsole: false }))
        const polls = [
            concat(
                words(16, 0xc189, 0xd103, 0x48),
                words(28, 0xc18a, 0xd103, 3, 2, 0x48, 0x50),
                words(12, 0xc1a5, 0xaabbccdd)
            ),
            words(20, 0xc18a, 0xd103, 3, 0),
        ]
        const observed: number[] = []
        const mutate = (event: { data: Uint8Array }) => event.data.fill(0)
        camera.onRawEvent(mutate)
        camera.onRawEvent(event => {
            if (event.code === 0xc1a5) observed.push(new DataView(event.data.buffer).getUint32(0, true))
        })
        camera.send = (async operation => {
            if (operation.code === 0x1001) return { code: 0x2001, data: { operationsSupportedRaw: [] } }
            if (operation.code === 0x9116)
                return { code: 0x2001, data: polls.length ? codec.decode(polls.shift()!).value : [] }
            return { code: 0x2001 }
        }) as typeof camera.send
        try {
            await camera.connect()
            expect(observed).toEqual([0xaabbccdd])
            expect(camera.getPropertyAllowedValues(camera.registry.properties.CanonIso)).toEqual([])
            expect(camera.listPropertyStates().find(state => state.code === 0xd103)?.allowedValues).toEqual([])
            const highValue = camera.registry.events.CanonValueChanged.parameters[1].codec(camera.registry)
            expect(highValue.decode(highValue.encode(0x80000518)).value).toBe(0x80000518)
            camera.offRawEvent(mutate)
        } finally {
            const disconnecting = camera.disconnect()
            await vi.runAllTimersAsync()
            await disconnecting
            vi.useRealTimers()
        }
    })
})
