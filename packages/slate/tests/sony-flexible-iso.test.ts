import { describe, expect, it } from 'vitest'
import { SonyCamera } from '@camera/sony-camera'
import { Camera } from '@camera/index'
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import type { SonyDevicePropDesc } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

function fixture(flexible = true, initialMode = 2) {
    let mode = initialMode, iso = 1250
    let manualChoices = [0xffffff, 100, 1250]
    const writes: Array<{ code: number; value: number }> = []
    const descriptor = (code: number, raw: number, choices: number[], enabled: boolean): SonyDevicePropDesc => ({
        devicePropertyCode: code, dataType: code === 0xd01c ? 2 : 6,
        devicePropertyName: code === 0xd01c ? 'GainControlSetting' : 'Iso',
        currentValueRaw: raw, currentValueDecoded: code === 0xd01c ? (raw === 1 ? 'Auto' : 'Manual') : `ISO ${raw}`,
        supportedValuesRaw: choices, supportedValuesDecoded: choices.map(value =>
            code === 0xd01c ? (value === 1 ? 'Auto' : 'Manual') : value === 0xffffff ? 'ISO AUTO' : `ISO ${value}`),
        vendorExtensions: { enabled }, sonyGetSetFlag: 1, sonyEnabledFlag: enabled ? 1 : 2,
        getSet: 'GET_SET',
    } as SonyDevicePropDesc)
    const inventory = () => [
        ...(flexible ? [descriptor(0xd01c, mode, [1, 2], true)] : []),
        descriptor(0xd21e, iso, mode === 1 ? [] : manualChoices, mode === 2),
    ]
    const owner = new Camera({ vendorId: 0x054c,
        transport: { isLittleEndian: () => true, isConnected: () => false, disconnect: async () => {} } as TransportInterface,
        logger: { captureConsole: false, renderInTerminal: false } })
    const camera = owner.getInstance() as SonyCamera
    camera.send = (async (operation, parameters: any, payload?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') {
            const codec = new DeviceInfoCodec(camera.registry)
            return { code: 0x2001, data: codec.decode(codec.encode({
                standardVersion: 100, vendorExtensionID: 0, vendorExtensionVersion: 100,
                vendorExtensionDesc: '', functionalMode: 0,
                operationsSupportedRaw: [0x1001, 0x9209], operationsSupportedDecoded: [],
                eventsSupportedRaw: [], eventsSupportedDecoded: [], devicePropertiesSupported: [],
                devicePropertiesSupportedDecoded: [], captureFormats: [],
                imageFormatsRaw: [], imageFormatsDecoded: [], manufacturer: 'Fixture',
                model: 'Fixture', deviceVersion: '1', serialNumber: '',
            })).value }
        }
        if (operation.name === 'SDIO_GetAllExtDevicePropInfo') return { code: 0x2001, data: { properties: inventory() } }
        if (operation.name === 'SDIO_GetExtDevicePropValue') return { code: 0x2001, data: inventory().find(p => p.devicePropertyCode === parameters.DevicePropCode) }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const code = parameters.DevicePropCode
            const value = code === 0xd01c ? payload![0]! : new DataView(payload!.buffer, payload!.byteOffset).getUint32(0, true)
            writes.push({ code, value })
            if (code === 0xd01c) mode = value
            else iso = value
        }
        return { code: 0x2001 }
    }) as typeof camera.send
    return { camera, owner, writes, setManualChoices: (choices: number[]) => { manualChoices = choices } }
}

describe('Sony Flexible Exposure ISO', () => {
    it('uses the advertised mode switch for Auto and reads the effective ISO mode', async () => {
        const { camera, writes } = fixture()
        await camera.setIso('ISO AUTO')
        expect(writes).toEqual([{ code: 0xd01c, value: 1 }])
        expect(await camera.getIso()).toBe('ISO AUTO')
        const raw = camera.listPropertyStates().find(p => p.code === 0xd21e)!
        expect(raw.rawValue).toBe(1250)
        expect(raw.writable).toBe(false)
    })
    it('restores manual mode before setting and reading an advertised sensitivity', async () => {
        const { camera, writes } = fixture()
        await camera.setIso('auto')
        await camera.setIso('ISO 100')
        expect(await camera.getIso()).toBe('ISO 100')
        expect(writes.slice(1)).toEqual([{ code: 0xd01c, value: 2 }, { code: 0xd21e, value: 100 }])
    })
    it('restores Auto when the manual sensitivity is rejected after switching modes', async () => {
        const { camera, writes } = fixture()
        await camera.setIso('auto')
        await expect(camera.setIso('99999')).rejects.toThrow('not advertised')
        expect(await camera.getIso()).toBe('ISO AUTO')
        expect(writes.some(write => write.code === 0xd21e)).toBe(false)
    })
    it('retains legacy Auto ISO encoding when the separate mode is absent', async () => {
        const { camera, writes } = fixture(false)
        await camera.setIso('auto')
        expect(writes).toEqual([{ code: 0xd21e, value: 0xffffff }])
    })
    it('preserves advertised manual choices in this owned session when Auto hides the ISO list', async () => {
        const { owner, writes } = fixture()
        expect((await owner.getCapabilities()).controls.iso?.allowedValues).toContain('ISO 1250')
        await owner.setControl('iso', 'ISO AUTO')
        expect((await owner.getCapabilities()).controls.iso).toMatchObject({
            value: 'ISO AUTO', enabled: true, writable: true,
            allowedValues: ['ISO AUTO', 'ISO 100', 'ISO 1250'],
        })
        await expect(owner.setControl('iso', 'ISO 800')).rejects.toThrow('not advertised')
        await owner.setControl('iso', 'ISO 100')
        expect(await owner.getIso()).toBe('ISO 100')
        expect(writes).toEqual([{ code: 0xd01c, value: 1 }, { code: 0xd01c, value: 2 }, { code: 0xd21e, value: 100 }])
    })
    it('does not invent a manual sensitivity when the first observed inventory is Auto', async () => {
        const { owner, writes } = fixture(true, 1)
        expect((await owner.getCapabilities()).controls.iso).toMatchObject({ value: 'ISO AUTO', writable: false })
        await expect(owner.setControl('iso', 'ISO 100')).rejects.toThrow('not writable')
        expect(writes).toEqual([])
    })
    it('clears retained manual ISO choices on disconnect, including a lost USB session', async () => {
        const { owner } = fixture()
        await owner.getCapabilities()
        await owner.setControl('iso', 'ISO AUTO')
        await owner.disconnect()
        expect((await owner.getCapabilities()).controls.iso?.writable).toBe(false)
    })
    it('revalidates retained manual values and restores Auto if the fresh inventory rejects them', async () => {
        const { owner, writes, setManualChoices } = fixture()
        await owner.getCapabilities()
        await owner.setControl('iso', 'ISO AUTO')
        setManualChoices([0xffffff, 100])
        await expect(owner.setControl('iso', 'ISO 1250')).rejects.toThrow('not advertised')
        expect(await owner.getIso()).toBe('ISO AUTO')
        expect(writes).toEqual([{ code: 0xd01c, value: 1 }, { code: 0xd01c, value: 2 }, { code: 0xd01c, value: 1 }])
    })
})
