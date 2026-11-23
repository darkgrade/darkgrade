import { CanonExtendedDeviceInfoDatasetCodec } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import { createCanonRegistry } from '@ptp/registry'
import { describe, expect, it } from 'vitest'

function dataset(headerWord: number, arrays: number[][], trailing = new Uint8Array()): Uint8Array {
    const words = [headerWord, ...arrays.flatMap(codes => [codes.length, ...codes])]
    const buffer = new Uint8Array(words.length * 4 + trailing.length)
    const view = new DataView(buffer.buffer)
    words.forEach((word, index) => view.setUint32(index * 4, word, true))
    buffer.set(trailing, words.length * 4)
    return buffer
}

describe('Canon extended device information', () => {
    const registry = createCanonRegistry(true)
    const codec = new CanonExtendedDeviceInfoDatasetCodec(registry)

    it('registers a parameterless inbound-data audit operation', () => {
        expect(registry.operations.CanonGetExtendedDeviceInfo).toMatchObject({
            code: 0x9108,
            dataDirection: 'out',
            operationParameters: [],
            responseParameters: [],
        })
    })

    it('preserves an opaque header, full uint32 codes, remote mode numbers and trailing bytes', () => {
        const payload = dataset(892, [[0xc189, 0xffffffff], [0xd2a5], [0, 1, 2, 4, 8]], Uint8Array.of(7, 8, 9))
        const backing = new Uint8Array(payload.length + 7)
        backing.set(payload, 5)
        const result = codec.decode(backing.subarray(2), 3)
        expect(result.value).toEqual({
            headerWord: 892,
            eventCodes: [0xc189, 0xffffffff],
            propertyCodes: [0xd2a5],
            remoteModes: [0, 1, 2, 4, 8],
            trailingByteCount: 5,
        })
        expect(result.bytesRead).toBe(payload.length - 3)
    })

    it('accepts empty arrays without interpreting the header as the payload length', () => {
        expect(codec.decode(dataset(0xffffffff, [[], [], []])).value).toEqual({
            headerWord: 0xffffffff,
            eventCodes: [],
            propertyCodes: [],
            remoteModes: [],
            trailingByteCount: 0,
        })
    })

    it.each([-1, 0.5, Number.NaN, 17])('rejects invalid offsets (%s)', offset => {
        expect(() => codec.decode(new Uint8Array(16), offset)).toThrow('Invalid Canon extended device information offset')
    })

    it('rejects every truncated prefix of a dataset with nonempty arrays', () => {
        const complete = dataset(0, [[0xc189], [0xd2a5], [0, 1]])
        for (let length = 0; length < complete.length; length++) {
            expect(() => codec.decode(complete.subarray(0, length))).toThrow('Truncated Canon extended device information')
        }
    })

    it.each([0, 1, 2])('bounds array %s before allocating an advertised uint32 count', arrayIndex => {
        const payload = dataset(0, [[], [], []])
        new DataView(payload.buffer).setUint32(4 + arrayIndex * 4, 0xffffffff, true)
        expect(() => codec.decode(payload)).toThrow('array')
    })
})
