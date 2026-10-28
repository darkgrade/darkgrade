import { Logger } from '@core/logger'
import { selectMatchingUSBDevice, USBTransport } from '@transport/usb/usb-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
    vi.restoreAllMocks()
})

const cameras = [
    { vendorId: 0x04a9, productId: 0x3294, serialNumber: 'one', classCode: 6, subclassCode: 1, protocolCode: 1 },
    { vendorId: 0x04a9, productId: 0x3294, serialNumber: 'two', classCode: 6, subclassCode: 1, protocolCode: 1 },
]

describe('physical USB camera selection', () => {
    it('closes a handle when initialization fails after USB open, even before connected is true', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {})
        const close = vi.fn().mockResolvedValue(undefined)
        const device = { open: vi.fn().mockResolvedValue(undefined), configurations: [], close }
        const transport = new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false }))
        Object.assign(transport, { getUSB: async () => ({}) })
        vi.spyOn(transport, 'discover').mockResolvedValue([
            { ...cameras[0], device } as unknown as Awaited<ReturnType<USBTransport['discover']>>[number],
        ])
        await expect(transport.connect({ usb: { filters: [{ serialNumber: 'one' }] } })).rejects.toThrow(
            'No USB configuration'
        )
        expect(close).toHaveBeenCalledOnce()
        expect(transport.isConnected()).toBe(false)
        await transport.disconnect()
        expect(close).toHaveBeenCalledOnce()
    })
    it('uses serial readback to select the mapped body when multiple bodies share VID/PID', () => {
        expect(
            selectMatchingUSBDevice(cameras, {
                usb: { filters: [{ vendorId: 0x04a9, productId: 0x3294, serialNumber: 'two' }] },
            })
        ).toBe(cameras[1])
        expect(() =>
            selectMatchingUSBDevice(cameras, { usb: { filters: [{ vendorId: 0x04a9, productId: 0x3294 }] } })
        ).toThrow(/unique serialNumber/)
    })

    it('honors alternative filters, exclusions and protocol class before opening any camera', () => {
        expect(
            selectMatchingUSBDevice(cameras, {
                usb: {
                    filters: [{ vendorId: 0x054c }, { vendorId: 0x04a9, protocolCode: 1 }],
                    exclusionFilters: [{ serialNumber: 'one' }],
                },
            })
        ).toBe(cameras[1])
        expect(() => selectMatchingUSBDevice(cameras, { usb: { filters: [{ protocolCode: 2 }] } })).toThrow(
            /No matching/
        )
    })
})
