import { NikonCamera } from '@camera/nikon-camera'
import { Logger } from '@core/logger'
import { PTPResponseError } from '@core/ptp-errors'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

function cameraFixture() {
    return new NikonCamera(
        { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface,
        new Logger({ captureConsole: false, renderInTerminal: false })
    )
}

describe('Nikon standard property fallback', () => {
    it('reads and writes a standard property when the body refuses only the extension operation', async () => {
        const camera = cameraFixture()
        const property = camera.registry.properties.ExposureIndex
        const send = vi.spyOn(camera, 'send').mockImplementation(async operation => {
            if (operation.code === 0x943a || operation.code === 0x943c) return { code: 0x2005 } as any
            if (operation.code === 0x1014) return { code: 0x2001, data: { currentValueDecoded: '200' } } as any
            return { code: 0x2001 } as any
        })
        await expect(camera.get(property)).resolves.toBe('200')
        await expect(camera.set(property, '400')).resolves.toBeUndefined()
        expect(send.mock.calls.map(([operation]) => operation.code)).toEqual([0x943a, 0x1014, 0x943c, 0x1016])
        expect(send.mock.calls[2][2]).toEqual(send.mock.calls[3][2])
        expect(send.mock.calls[3][1]).toEqual({ DevicePropCode: property.code })
    })

    it('preserves property refusal, busy and access-denied responses without a second operation', async () => {
        for (const code of [0x200a, 0x2019, 0x200f]) {
            const camera = cameraFixture()
            const send = vi.spyOn(camera, 'send').mockResolvedValue({ code } as any)
            const property = camera.registry.properties.ExposureIndex
            await expect(camera.get(property)).rejects.toMatchObject({ code, operation: 'GetDevicePropDescEx' })
            await expect(camera.set(property, '400')).rejects.toMatchObject({ code, operation: 'SetDevicePropValueEx' })
            expect(send).toHaveBeenCalledTimes(2)
        }
    })

    it('never truncates an extended property code and reports a failed fallback as the standard operation', async () => {
        const camera = cameraFixture()
        const property = camera.registry.properties.ExposureIndex
        const send = vi.spyOn(camera, 'send').mockResolvedValue({ code: 0x2005 } as any)
        const extendedProperty = { ...property, code: 0x10000500 }
        await expect(camera.get(extendedProperty)).rejects.toBeInstanceOf(PTPResponseError)
        await expect(camera.set(extendedProperty, '400')).rejects.toBeInstanceOf(PTPResponseError)
        expect(send).toHaveBeenCalledTimes(2)
        send.mockClear()
        send.mockResolvedValueOnce({ code: 0x2005 } as any).mockResolvedValueOnce({ code: 0x200a } as any)
        await expect(camera.get(property)).rejects.toMatchObject({ code: 0x200a, operation: 'GetDevicePropDesc' })
        expect(send).toHaveBeenCalledTimes(2)
    })
})
