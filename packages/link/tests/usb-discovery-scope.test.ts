import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ options: [] as any[], touched: [] as number[], requests: 0 }))
vi.mock('usb', async () => {
    const actual = await vi.importActual<typeof import('usb')>('usb')
    // Keep node-usb's real VID/PID quickFilter and getDevices authorization logic.
    class ObservedWebUSB extends (actual.WebUSB as new(options: any) => any) {
        constructor(options: any) { super(options); fixture.options.push(options) }
        async getWebDevice(device: any) { fixture.touched.push(device.deviceDescriptor.idVendor); return device.webDevice }
        async requestDevice() { fixture.requests++; throw new Error('Node discovery must not request other devices') }
    }
    return { ...actual, WebUSB: ObservedWebUSB }
})
import { usb } from 'usb'
import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'

function device(vendorId: number, productId: number, serialNumber = '') {
    const alternate = { interfaceClass: 6, interfaceSubclass: 1, interfaceProtocol: 1 }
    const webDevice = {
        vendorId, productId, serialNumber, deviceClass: 0, deviceSubclass: 0, deviceProtocol: 0,
        configuration: { interfaces: [{ alternate, alternates: [alternate] }] },
        open: vi.fn().mockRejectedValue(new Error('selected camera')),
    }
    return { deviceDescriptor: { idVendor: vendorId, idProduct: productId }, webDevice }
}
function transport() { return new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false })) }
const sony = device(0x054c, 0x0f4a, 'sony')
const nikon = device(0x04b0, 0x0450, 'nikon')
const capture = device(0x0fd9, 0x0066)
const hub = device(0x2109, 0x0822)

beforeEach(() => {
    fixture.options.length = 0; fixture.touched.length = 0; fixture.requests = 0
    sony.webDevice.open.mockRejectedValue(new Error('selected camera'))
    vi.spyOn(usb, 'getDeviceList').mockReturnValue([capture, hub, nikon, sony] as any)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('USB discovery scope', () => {
    it('prefilters a known camera before descriptor creation and never requests unrelated vendors', async () => {
        await expect(transport().connect({ usb: { filters: [{ vendorId: 0x054c, productId: 0x0f4a }] } })).rejects.toThrow('selected camera')
        expect(fixture.touched).toEqual([0x054c])
        expect(fixture.requests).toBe(0)
        expect(fixture.options).toEqual([{ allowedDevices: [{ vendorId: 0x054c, productId: 0x0f4a }], allowAllDevices: false, deviceTimeout: 1000 }])
    })

    it('limits default discovery to PTP vendors before opening descriptors', async () => {
        const devices = await transport().discover()
        expect(devices.map(device => device.vendorId)).toEqual([0x04b0, 0x054c])
        expect(fixture.touched).toEqual([0x04b0, 0x054c])
        expect(fixture.requests).toBe(0)
    })

    it('creates a fresh narrowed WebUSB scope after broad discovery', async () => {
        const connection = transport()
        await connection.discover()
        fixture.touched.length = 0
        await expect(connection.connect({ usb: { filters: [{ vendorId: 0x054c, productId: 0x0f4a }] } })).rejects.toThrow('selected camera')
        expect(fixture.options).toHaveLength(2)
        expect(fixture.touched).toEqual([0x054c])
    })

    it('uses every alternative filter when selecting the camera', async () => {
        await expect(transport().connect({ usb: { filters: [
            { vendorId: 0x04a9, productId: 1 }, { vendorId: 0x054c, productId: 0x0f4a },
        ] } })).rejects.toThrow('selected camera')
        expect(fixture.touched).toEqual([0x054c])
    })

    it('honors an explicitly requested vendor outside the default PTP list', async () => {
        const custom = device(0x1234, 1)
        vi.mocked(usb.getDeviceList).mockReturnValue([capture, hub, custom] as any)
        expect((await transport().discover({ usb: { filters: [{ vendorId: 0x1234 }] } }))[0]?.vendorId).toBe(0x1234)
        expect(fixture.touched).toEqual([0x1234])
    })

    it('keeps browser discovery permission-only and requests the target once on connect', async () => {
        let granted = false
        const browser = {
            getDevices: vi.fn(async () => granted ? [sony.webDevice] : []),
            requestDevice: vi.fn(async () => { granted = true; return sony.webDevice }),
        }
        vi.stubGlobal('navigator', { usb: browser })
        const connection = transport()
        expect(await connection.discover()).toEqual([])
        expect(browser.requestDevice).not.toHaveBeenCalled()
        const filters = [{ vendorId: 0x054c, productId: 0x0f4a }]
        await expect(connection.connect({ usb: { filters } })).rejects.toThrow('selected camera')
        expect(browser.requestDevice).toHaveBeenCalledOnce()
        expect(browser.requestDevice).toHaveBeenCalledWith({ filters })
        expect(fixture.options).toEqual([])
        expect(fixture.touched).toEqual([])
    })

    it('never prompts when the matching browser camera is already granted', async () => {
        const browser = { getDevices: vi.fn(async () => [sony.webDevice]), requestDevice: vi.fn() }
        vi.stubGlobal('navigator', { usb: browser })
        await expect(transport().connect({ usb: { filters: [{ vendorId: 0x054c }] } })).rejects.toThrow('selected camera')
        expect(browser.requestDevice).not.toHaveBeenCalled()
    })

    it('filters unrelated browser grants without requesting more permission', async () => {
        const browser = { getDevices: vi.fn(async () => [capture.webDevice, hub.webDevice, sony.webDevice]), requestDevice: vi.fn() }
        vi.stubGlobal('navigator', { usb: browser })
        expect((await transport().discover()).map(device => device.vendorId)).toEqual([0x054c])
        expect(browser.requestDevice).not.toHaveBeenCalled()
    })

    it('surfaces browser permission denial without falling back to Node access', async () => {
        const browser = { getDevices: vi.fn(async () => []), requestDevice: vi.fn().mockRejectedValue(new Error('Permission denied')) }
        vi.stubGlobal('navigator', { usb: browser })
        await expect(transport().connect({ usb: { filters: [{ vendorId: 0x054c }] } })).rejects.toThrow('Permission denied')
        expect(fixture.options).toEqual([])
        expect(fixture.touched).toEqual([])
    })
})
