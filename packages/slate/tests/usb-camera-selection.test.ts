import { Logger } from '@core/logger'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
    vi.restoreAllMocks()
})

const camera = { vendorId: 0x04a9, productId: 0x3294, serialNumber: 'one', classCode: 6, subclassCode: 1, protocolCode: 1 }

describe('physical USB camera selection', () => {
    it('closes a handle when initialization fails after USB open, even before connected is true', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const close = vi.fn().mockResolvedValue(undefined)
        const device = { ...camera, open: vi.fn().mockResolvedValue(undefined), configurations: [], close }
        const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
        Object.assign(transport, { getUSB: async () => ({}) })
        vi.spyOn(transport, 'discover').mockResolvedValue([
            { ...camera, device } as unknown as Awaited<ReturnType<USBTransport['discover']>>[number],
        ])
        await expect(transport.connect({ usb: { filters: [{ serialNumber: 'one' }] } })).rejects.toThrow(
            'No USB configuration'
        )
        expect(close).toHaveBeenCalledOnce()
        expect(transport.isConnected()).toBe(false)
        expect(console.log).not.toHaveBeenCalled()
        await transport.disconnect()
        expect(close).toHaveBeenCalledOnce()
    })

    it('opens only the uniquely filtered body, refusing ambiguous, excluded or absent matches', async () => {
        const bodies = ['one', 'two'].map(serialNumber => ({
            ...camera,
            serialNumber,
            open: vi.fn().mockRejectedValue(new Error(`opened ${serialNumber}`)),
            close: vi.fn().mockResolvedValue(undefined),
        }))
        const cases: [DeviceDescriptor['usb'], string | RegExp][] = [
            [{ filters: [{ vendorId: 0x04a9, serialNumber: 'two' }] }, 'opened two'],
            [{ filters: [{ vendorId: 0x04a9 }] }, /unique serialNumber/],
            [{ filters: [{ vendorId: 0x04a9 }], exclusionFilters: [{ serialNumber: 'one' }] }, 'opened two'],
            [{ filters: [{ vendorId: 0x04a9, serialNumber: 'absent' }] }, 'No USB devices available'],
        ]
        for (const [usb, expected] of cases) {
            const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
            Object.assign(transport, { getUSB: async () => ({ getDevices: async () => bodies }) })
            await expect(transport.connect({ usb })).rejects.toThrow(expected)
        }
        expect(bodies[0].open).not.toHaveBeenCalled()
    })
})
