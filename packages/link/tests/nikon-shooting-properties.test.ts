import { Camera } from '@camera/index'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

// Numeric observations from Z6 III camera_controls, 2026-10-29.
// Wire types independently checked against the model command specification Rev.2.00.
// These are descriptor fixtures; this test does not communicate with hardware.
const observed = [
    [0xd01e, 0x0004, 5000], [0xd21a, 0x0004, 5000], [0xd1aa, 0x0006, 20000],
    [0xd054, 0x0002, 1], [0xd0ad, 0x0002, 0], [0xd23a, 0x0004, 32789],
    [0xd1a8, 0x0006, 65586], [0xd1a9, 0x0004, 400], [0xd061, 0x0002, 0],
    [0xd1fa, 0x0002, 2], [0xd156, 0x0002, 1], [0xd1f2, 0x0002, 2],
    [0xd1f1, 0x0006, 12323], [0x1d015, 0x0002, 0], [0x1d016, 0x0002, 0],
] as const

function descriptor(code: number, datatype: number, current: number) {
    const width = datatype === 2 ? 1 : datatype === 4 ? 2 : 4
    const bytes = new Uint8Array(8 + 2 * width)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, code, true)
    view.setUint16(4, datatype, true)
    view.setUint8(6, [0xd1f1, 0xd1f2].includes(code) ? 0 : 1)
    if (width === 1) view.setUint8(7 + width, current)
    else if (width === 2) view.setUint16(7 + width, current, true)
    else view.setUint32(7 + width, current, true)
    return bytes
}

function fixture() {
    return new Camera({
        vendorId: 0x04b0,
        transport: { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
        logger: { captureConsole: false, renderInTerminal: false },
    })
}

describe('Nikon captured shooting properties', () => {
    it('reads all fifteen captured controls using exact descriptor widths and numeric values', async () => {
        const camera = fixture()
        const instance = camera.getInstance()
        const codec = new DevicePropDescCodec(instance.registry, true)
        const definitions = Object.values(instance.registry.properties)
        const send = vi.spyOn(instance, 'send')
        for (const [code, datatype, value] of observed) {
            const matching = definitions.filter(property => property.code === code)
            expect(matching, `one registered definition for ${code.toString(16)}`).toHaveLength(1)
            const property = matching[0]!
            expect(property.datatype).toBe(datatype)
            const decoded = codec.decode(descriptor(code, datatype, value)).value
            expect(decoded.currentValueDecoded).toBe(value)
            send.mockResolvedValueOnce({ code: 0x2001, data: decoded } as any)
            await expect(camera.get(property)).resolves.toBe(value)
            expect(send.mock.lastCall?.[1]).toEqual({ DevicePropCode: code })
        }
    })

    it('retains 32-bit focus codes and writes ISO as a number without treating 1000 as Auto ISO', async () => {
        const camera = fixture()
        const instance = camera.getInstance()
        const properties = instance.registry.properties as any
        const send = vi.spyOn(instance, 'send').mockResolvedValue({ code: 0x2001 } as any)
        await camera.set(properties.NikonFocusPointLock, 1)
        await camera.set(properties.NikonMovieFocusPointLock, 0)
        await camera.set(properties.NikonMovieISO, 1000)
        expect(send.mock.calls.map(([op, params, bytes]) => [op.code, params, Array.from(bytes ?? [])])).toEqual([
            [0x943c, { DevicePropCode: 0x1d015 }, [1]],
            [0x943c, { DevicePropCode: 0x1d016 }, [0]],
            [0x943c, { DevicePropCode: 0xd1aa }, [0xe8, 0x03, 0, 0]],
        ])
        await expect(camera.set(properties.NikonActiveSlot, 1)).rejects.toThrow('not writable')
        await expect(camera.set(properties.NikonExposureRemaining, 1)).rejects.toThrow('not writable')
        expect(send).toHaveBeenCalledTimes(3)
    })
})
