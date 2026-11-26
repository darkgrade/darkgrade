import { Camera } from '@camera/index'
import { protocolSession } from '@camera/protocol-session'
import { fakeTransport } from '@tests/fixtures/camera-fixtures'
import { nikonCamera } from '@tests/fixtures/nikon'
import { vendorDriver } from '@tests/fixtures/vendor-driver'
import { NikonEventListCodec } from '@vendors/nikon/datasets/nikon-event-list-dataset'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { describe, expect, it, vi } from 'vitest'

describe('Nikon event polling', () => {
    it('delivers movie, SDRAM and extended property notifications without losing unknown records', async () => {
        const wrapper = new Camera({ vendorId: 0x04b0, transport: fakeTransport(), logger: { captureConsole: false, renderInTerminal: false } })
        const camera = protocolSession(wrapper).driver as NikonCamera
        const codec = new NikonEventDataCodec(camera.registry)
        const recorded = [
            { code: 0xc101, parameters: [0xffff0001] },
            { code: 0xc108, parameters: [2, 3] },
            { code: 0xc105, parameters: [2, 0] },
            { code: 0x4006, parameters: [0x1000d020] },
            { code: 0xc1ff, parameters: [1, 2, 3] },
        ]
        const send = vi.spyOn(camera, 'send').mockResolvedValue({ code: 0x2001, data: codec.decode(codec.encode(recorded)).value } as any)
        const [object, complete, interrupted, property] = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
        camera.on(camera.registry.events.ObjectAddedInSdram, object)
        camera.on(camera.registry.events.MovieRecordComplete, complete)
        camera.on(camera.registry.events.MovieRecordInterrupted, interrupted)
        camera.on(camera.registry.events.DevicePropChanged, property)
        expect(await vendorDriver(wrapper, NikonCamera).pollEvents()).toEqual(recorded)
        expect(object).toHaveBeenCalledWith({ ObjectHandle: 0xffff0001 })
        expect(complete).toHaveBeenCalledWith({ RecordKind: 2, StopCode: 3 })
        expect(interrupted).toHaveBeenCalledWith({ ErrorCode: 2, RecordKind: 0 })
        expect(property).toHaveBeenCalledWith({ DevicePropCode: 0x1000d020 })
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('falls back to the one-parameter queue only when GetEventEx itself is unsupported', async () => {
        const camera = nikonCamera()
        const codec = new NikonEventListCodec(camera.registry)
        const send = vi.spyOn(camera, 'send').mockResolvedValueOnce({ code: 0x2005 } as any).mockResolvedValueOnce({
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
