import { createPTPRegistry } from '@ptp/registry'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { SDIExtDevicePropInfoCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { NikonEventListCodec } from '@ptp/datasets/vendors/nikon/nikon-event-list-dataset'
import { describe, expect, it } from 'vitest'

// Independent wire seeds, not encoded by the implementation under test. Layouts:
// PTP DevicePropDesc; Sony SDI descriptors; Canon EOS GetEvent and Nikon GetEvent
// as documented in libgphoto2 camlibs/ptp2/ptp-pack.c @02d92fea.
// All bytes are synthetic, with no borrowed camera identity or media.
const registry = createPTPRegistry(true)
const seeds = [
    { name: 'standard descriptor', codec: new DevicePropDescCodec(registry),
        bytes: [15, 80, 4, 0, 1, 100, 0, 100, 0, 2, 2, 0, 100, 0, 200, 0] },
    { name: 'Sony descriptor', codec: new SDIExtDevicePropInfoCodec(registry),
        bytes: [15, 80, 4, 0, 1, 1, 100, 0, 100, 0, 0] },
    { name: 'Canon event', codec: new CanonEventDataCodec(registry),
        bytes: [16, 0, 0, 0, 137, 193, 0, 0, 1, 209, 0, 0, 72, 0, 0, 0] },
    { name: 'Nikon event', codec: new NikonEventListCodec(registry),
        bytes: [1, 0, 2, 64, 15, 80, 0, 0] },
]

describe('reproducible PTP input fuzzing', () => {
    for (const seed of seeds) {
        it(`${seed.name}: truncations cannot read adjacent backing bytes`, () => {
            const bytes = Uint8Array.from(seed.bytes)
            expect(seed.codec.decode(bytes).bytesRead).toBe(bytes.length)
            for (let length = 1; length < bytes.length; length++) {
                // Buffer still contains the entire packet; only its view is truncated.
                expect(() => seed.codec.decode(bytes.subarray(0, length)), `length ${length}`).toThrow()
            }
        })

        it(`${seed.name}: deterministic mutations either reject or consume bounded input`, () => {
            let state = 0x4d415452
            for (let iteration = 0; iteration < 512; iteration++) {
                state = (Math.imul(state, 1664525) + 1013904223) >>> 0
                const input = Uint8Array.from(seed.bytes)
                input[state % input.length] ^= (state >>> 16) & 255
                const before = input.slice()
                let result
                try { result = seed.codec.decode(input) } catch (error) {
                    expect(error).toBeInstanceOf(Error)
                }
                if (result) {
                    expect(Number.isInteger(result.bytesRead)).toBe(true)
                    expect(result.bytesRead).toBeGreaterThan(0)
                    expect(result.bytesRead).toBeLessThanOrEqual(input.length)
                }
                expect(input).toEqual(before)
            }
        })
    }

    it('rejects malformed offsets on every base codec, including views inside larger buffers', () => {
        const input = new Uint8Array(48).fill(1).subarray(16, 32)
        for (const [name, codec] of Object.entries(registry.codecs)) {
            for (const offset of [-1, -0.5, 0.5, NaN, Infinity, 17]) {
                expect(() => codec.decode(input, offset), `${name} offset ${offset}`).toThrow()
            }
        }
    })

    it('rejects all reserved Sony descriptor form flags', () => {
        const seed = seeds[1]
        for (let flag = 3; flag <= 255; flag++) {
            const input = Uint8Array.from(seed.bytes)
            input[10] = flag
            expect(() => seed.codec.decode(input), `form ${flag}`).toThrow()
        }
    })

    it('PTP strings respect the one-byte length and UTF-16 terminator', () => {
        for (const littleEndian of [true, false]) {
            const codec = createPTPRegistry(littleEndian).codecs.string
            for (const length of [0, 1, 253, 254]) {
                const text = 'a'.repeat(length)
                expect(codec.decode(codec.encode(text)).value).toBe(text)
            }
            for (const length of [255, 256, 511, 1024]) {
                expect(() => codec.encode('a'.repeat(length))).toThrow()
            }
            expect(() => codec.decode(Uint8Array.from([1, 65, 65]))).toThrow()
            expect(codec.decode(Uint8Array.from([0])).value).toBe('')
        }
    })
})
