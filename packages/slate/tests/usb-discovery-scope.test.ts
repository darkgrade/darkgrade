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
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { USBTransport } from '@transport/usb/usb-transport'

function device(vendorId: number, productId: number, serialNumber = '', interfaceClass = 6, interfaceSubclass = 1) {
    const alternate = { interfaceClass, interfaceSubclass, interfaceProtocol: 1 }
    const configDescriptor = { interfaces: [[{ bInterfaceClass: interfaceClass, bInterfaceSubClass: interfaceSubclass, bInterfaceProtocol: 1 }]] }
    const webDevice = {
        vendorId, productId, serialNumber, deviceClass: 0, deviceSubclass: 0, deviceProtocol: 0,
        configuration: { interfaces: [{ alternate, alternates: [alternate] }] },
        open: vi.fn().mockRejectedValue(new Error('selected camera')),
        close: vi.fn().mockResolvedValue(undefined),
    }
    return { deviceDescriptor: { idVendor: vendorId, idProduct: productId }, allConfigDescriptors: [configDescriptor], webDevice }
}
function transport() { return new USBTransport(new Logger({ captureConsole: false, renderInTerminal: false })) }
const sony = device(0x054c, 0x0f4a, 'sony')
const nikon = device(0x04b0, 0x0450, 'nikon')
const capture = device(0x0fd9, 0x0066, '', 0xff, 0)
const hub = device(0x2109, 0x0822, '', 9, 0)
const fujifilm = device(VendorIDs.FUJIFILM, 0x02e3, 'fujifilm')
const panasonic = device(VendorIDs.PANASONIC, 0x2382, 'panasonic')
const olympus = device(VendorIDs.OLYMPUS, 0x012f, 'olympus')
const fujifilmCardReader = device(VendorIDs.FUJIFILM, 0x5006, 'card-reader', 8, 6)

beforeEach(() => {
    fixture.options.length = 0; fixture.touched.length = 0; fixture.requests = 0
    for (const camera of [sony, fujifilm, panasonic]) camera.webDevice.open.mockRejectedValue(new Error('selected camera'))
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

    it('limits default discovery to PTP interfaces before opening descriptors', async () => {
        const devices = await transport().discover()
        expect(devices.map(device => device.vendorId)).toEqual([0x04b0, 0x054c])
        expect(fixture.touched).toEqual([0x04b0, 0x054c])
        expect(fixture.requests).toBe(0)
    })

    it('finds any vendor\'s PTP body by default and leaves non-PTP devices closed', async () => {
        vi.mocked(usb.getDeviceList).mockReturnValue([capture, hub, fujifilmCardReader, fujifilm, panasonic, olympus] as any)
        const devices = await transport().discover()
        expect(devices.map(device => device.vendorId)).toEqual([VendorIDs.FUJIFILM, VendorIDs.PANASONIC, VendorIDs.OLYMPUS])
        expect(devices.map(device => device.serialNumber)).toEqual(['fujifilm', 'panasonic', 'olympus'])
        expect(fixture.touched).toEqual([VendorIDs.FUJIFILM, VendorIDs.PANASONIC, VendorIDs.OLYMPUS])
    })

    it('connects to a lone Fujifilm body without a device descriptor', async () => {
        fujifilm.webDevice.open.mockClear()
        vi.mocked(usb.getDeviceList).mockReturnValue([capture, hub, fujifilm] as any)
        await expect(transport().connect()).rejects.toThrow('selected camera')
        expect(fujifilm.webDevice.open).toHaveBeenCalledOnce()
        expect(fixture.touched).toEqual([VendorIDs.FUJIFILM])
    })

    it('refuses to guess between two PTP bodies on the default path', async () => {
        vi.mocked(usb.getDeviceList).mockReturnValue([fujifilm, panasonic] as any)
        await expect(transport().connect()).rejects.toThrow('Multiple USB cameras match')
    })

    it('opens nothing when no attached device has a PTP interface', async () => {
        vi.mocked(usb.getDeviceList).mockReturnValue([capture, hub, fujifilmCardReader] as any)
        expect(await transport().discover()).toEqual([])
        await expect(transport().connect()).rejects.toThrow('No USB devices available')
        expect(fixture.touched).toEqual([])
        expect(fixture.options).toEqual([])
    })

    it('offers any PTP device in the browser picker by default', async () => {
        let granted = false
        const browser = {
            getDevices: vi.fn(async () => granted ? [hub.webDevice, panasonic.webDevice] : []),
            requestDevice: vi.fn(async () => { granted = true; return panasonic.webDevice }),
        }
        vi.stubGlobal('navigator', { usb: browser })
        await expect(transport().connect()).rejects.toThrow('selected camera')
        expect(browser.requestDevice).toHaveBeenCalledWith({ filters: [{ classCode: 6, subclassCode: 1 }] })
        expect(panasonic.webDevice.open).toHaveBeenCalled()
        expect(hub.webDevice.open).not.toHaveBeenCalled()
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
