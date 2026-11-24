import {NikonCamera} from '@camera/nikon-camera'
import {Logger} from '@core/logger'
import type {TransportInterface} from '@transport/interfaces/transport.interface'
import {describe, expect, it, vi} from 'vitest'

function fixture(mode = 'PHOTO') {
    const camera = new NikonCamera({isLittleEndian: () => true, on: () => undefined} as unknown as TransportInterface,
        new Logger({captureConsole: false, renderInTerminal: false}))
    let current = 0x0001007d
    const writes: {code: number; value: number}[] = []
    const state = {mode, readOnly: false, refusal: 0, angle: false, wrongProperty: false, ignoreWrite: false, flipMode: false}
    let selectorReads = 0
    vi.spyOn(camera, 'send').mockImplementation(async (operation, parameters: any, bytes) => {
        const code = parameters.DevicePropCode
        if ([0x943c, 0x1016].includes(operation.code)) {
            const value = new DataView(bytes!.buffer, bytes!.byteOffset, bytes!.byteLength).getUint32(0, true)
            writes.push({code, value})
            if (!state.ignoreWrite) current = value
            return {code: 0x2001} as any
        }
        if (code === camera.registry.properties.LiveViewSelector.code) {
            selectorReads++
            return {code: 0x2001, data: {devicePropertyCode: code,
                currentValueDecoded: state.flipMode && selectorReads > 1 ? 'VIDEO' : state.mode}} as any
        }
        if (code === camera.registry.properties.MovieShutterMode.code)
            return {code: 0x2001, data: {devicePropertyCode: code, currentValueDecoded: state.angle ? 'SHUTTER_ANGLE' : 'SHUTTER_SPEED'}} as any
        if (state.refusal) return {code: state.refusal} as any
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
    it('does not hide a busy/denied native property with a standard-property fallback', async () => {
        for (const code of [0x2019, 0x200f]) {
            const {camera, state, writes} = fixture()
            state.refusal = code
            await expect(camera.setShutterSpeed('1/8000')).rejects.toMatchObject({code})
            expect(writes).toEqual([])
        }
    })
    it('reports a false write acknowledgement', async () => {
        const {camera, state} = fixture()
        state.ignoreWrite = true
        await expect(camera.setShutterSpeed('1/8000')).rejects.toThrow('readback')
    })
    it('rejects a physical selector change before writing to the old mode', async () => {
        const {camera, state, writes} = fixture()
        state.flipMode = true
        await expect(camera.setShutterSpeed('1/8000')).rejects.toThrow('mode changed')
        expect(writes).toEqual([])
    })
})
