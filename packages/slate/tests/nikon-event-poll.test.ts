import { NikonCamera } from '@camera/nikon-camera'
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { NikonEventListCodec } from '@ptp/datasets/vendors/nikon/nikon-event-list-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
import { describe, expect, it, vi } from 'vitest'

const fixture = () =>
    new NikonCamera(
        { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
        new Logger({ captureConsole: false, renderInTerminal: false })
    )

describe('Nikon event polling', () => {
    it('delivers movie, SDRAM and extended property notifications without losing unknown records', async () => {
        const wrapper = new Camera({
            vendorId: 0x04b0,
            transport: { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
            logger: { captureConsole: false, renderInTerminal: false },
        })
        const camera = wrapper.getInstance() as NikonCamera
        const codec = new NikonEventDataCodec(camera.registry)
        const recorded = [
            { code: 0xc101, parameters: [0xffff0001] },
            { code: 0xc108, parameters: [2, 3] },
            { code: 0xc105, parameters: [2, 0] },
            { code: 0x4006, parameters: [0x1000d020] },
            { code: 0xc1ff, parameters: [1, 2, 3] },
        ]
        const send = vi.spyOn(camera, 'send').mockResolvedValue({
            code: 0x2001,
            data: codec.decode(codec.encode(recorded)).value,
        } as any)
        const object = vi.fn(),
            complete = vi.fn(),
            interrupted = vi.fn(),
            property = vi.fn()
        camera.on(camera.registry.events.ObjectAddedInSdram, object)
        camera.on(camera.registry.events.MovieRecordComplete, complete)
        camera.on(camera.registry.events.MovieRecordInterrupted, interrupted)
        camera.on(camera.registry.events.DevicePropChanged, property)
        expect(await wrapper.pollNikonEvents()).toEqual(recorded)
        expect(object).toHaveBeenCalledWith({ ObjectHandle: 0xffff0001 })
        expect(complete).toHaveBeenCalledWith({ RecordKind: 2, StopCode: 3 })
        expect(interrupted).toHaveBeenCalledWith({ ErrorCode: 2, RecordKind: 0 })
        expect(property).toHaveBeenCalledWith({ DevicePropCode: 0x1000d020 })
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('falls back to the one-parameter queue only when GetEventEx itself is unsupported', async () => {
        const camera = fixture()
        const codec = new NikonEventListCodec(camera.registry)
        const send = vi
            .spyOn(camera, 'send')
            .mockResolvedValueOnce({ code: 0x2005 } as any)
            .mockResolvedValueOnce({
                code: 0x2001,
                data: codec.decode(codec.encode([{ code: 0xc108, parameter: 1 }])).value,
            } as any)
        const complete = vi.fn()
        camera.on(camera.registry.events.MovieRecordComplete, complete)
        expect(await camera.pollEvents()).toEqual([{ code: 0xc108, parameters: [1] }])
        expect(complete).toHaveBeenCalledWith({ RecordKind: 1 })
        expect(send.mock.calls.map(([operation]) => operation.code)).toEqual([0x941c, 0x90c7])
        send.mockReset().mockResolvedValue({ code: 0x2019 } as any)
        await expect(camera.pollEvents()).rejects.toMatchObject({ code: 0x2019, operation: 'GetEventEx' })
        expect(send).toHaveBeenCalledTimes(1)
        send.mockReset().mockResolvedValue({ code: 0x2001 } as any)
        await expect(camera.pollEvents()).rejects.toThrow('no event dataset')
    })
})
