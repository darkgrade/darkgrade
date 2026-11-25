import {nikonCamera} from '@tests/fixtures/nikon'
import {describe, expect, it, vi} from 'vitest'

function fixture(mode = 'PHOTO') {
    const camera = nikonCamera()
    let current = 0x0001007d
    const writes: {code: number; value: number}[] = []
    const state = {mode, readOnly: false, angle: false, wrongProperty: false}
    vi.spyOn(camera, 'send').mockImplementation(async (operation, parameters: any, bytes) => {
        const code = parameters.DevicePropCode
        if ([0x943c, 0x1016].includes(operation.code)) {
            const value = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength).getUint32(0, true)
            writes.push({code, value})
            current = value
            return {code: 0x2001} as any
        }
        if (code === camera.registry.properties.LiveViewSelector.code)
            return {code: 0x2001, data: {devicePropertyCode: code, currentValueDecoded: state.mode}} as any
        if (code === camera.registry.properties.MovieShutterMode.code)
            return {code: 0x2001, data: {devicePropertyCode: code, currentValueDecoded: state.angle ? 'SHUTTER_ANGLE' : 'SHUTTER_SPEED'}} as any
        return {code: 0x2001, data: {devicePropertyCode: state.wrongProperty ? 0x500f : code, dataType: 6,
            getSet: state.readOnly ? 'GET' : 'GET_SET', formFlag: 2, currentValueRaw: current,
            currentValueDecoded: current, supportedValuesRaw: [0x0001007d, 0x00011f40, 0x00010fa0, 0x000d000a, 0xffffffff, 0xfffffffd]}} as any
    })
    return {camera, writes, state}
}

describe('Nikon semantic shutter API', () => {
    it.each(['PHOTO', 'VIDEO'])('writes exact advertised fractions in %s mode and verifies readback', async mode => {
        const {camera, writes} = fixture(mode)
        for (const value of ['1/8000', '1/4000', '1.3s', '1/125']) await camera.setShutterSpeed(value)
        expect(writes).toEqual([0x00011f40, 0x00010fa0, 0x000d000a, 0x0001007d]
            .map(value => ({code: mode === 'PHOTO' ? 0xd100 : 0xd1a8, value})))
        expect(await camera.getShutterSpeed()).toBe('1/125')
    })
    it('retains Bulb and Time instead of interpreting their sentinels as fractions', async () => {
        const {camera} = fixture()
        await camera.setShutterSpeed('bulb')
        expect(await camera.getShutterSpeed()).toBe('BULB')
        await camera.setShutterSpeed('Time')
        expect(await camera.getShutterSpeed()).toBe('TIME')
    })
    it.each(['1/0', '-1', 'NaN', '1/16000', '1junk', '1/8000junk'])('rejects %s without writing', async value => {
        const {camera, writes} = fixture()
        await expect(camera.setShutterSpeed(value)).rejects.toThrow()
        expect(writes).toEqual([])
    })
    it('preserves mode and rejects angle/read-only/mismatched descriptors without a write', async () => {
        for (const condition of ['angle', 'readOnly', 'wrongProperty'] as const) {
            const {camera, writes, state} = fixture('VIDEO')
            state[condition] = true
            await expect(camera.setShutterSpeed('1/8000')).rejects.toThrow()
            expect(writes).toEqual([])
            expect(state.mode).toBe('VIDEO')
        }
    })
})
