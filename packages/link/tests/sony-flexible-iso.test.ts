import { describe, expect, it } from 'vitest'
import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import type { SonyDevicePropDesc } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

function fixture(flexible = true) {
    let mode = 2, iso = 1250
    const writes: Array<{ code: number; value: number }> = []
    const descriptor = (code: number, raw: number, choices: number[], enabled: boolean): SonyDevicePropDesc => ({
        devicePropertyCode: code, dataType: code === 0xd01c ? 2 : 6,
        devicePropertyName: code === 0xd01c ? 'GainControlSetting' : 'Iso',
        currentValueRaw: raw, currentValueDecoded: code === 0xd01c ? (raw === 1 ? 'Auto' : 'Manual') : `ISO ${raw}`,
        supportedValuesRaw: choices, supportedValuesDecoded: choices,
        vendorExtensions: { enabled }, sonyGetSetFlag: 1, sonyEnabledFlag: enabled ? 1 : 2,
        getSet: 'GET_SET',
    } as SonyDevicePropDesc)
    const inventory = () => [
        ...(flexible ? [descriptor(0xd01c, mode, [1, 2], true)] : []),
        descriptor(0xd21e, iso, mode === 1 ? [] : [0xffffff, 100, 1250], mode === 2),
    ]
    const camera = new SonyCamera({ isLittleEndian: () => true } as TransportInterface, new Logger({ captureConsole: false, renderInTerminal: false }))
    camera.send = (async (operation, parameters: any, payload?: Uint8Array) => {
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
    return { camera, writes }
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
})
