import {NikonCamera} from '@camera/nikon-camera'
import {Logger} from '@core/logger'
import {OK} from '@ptp/definitions/response-definitions'
import {createNikonRegistry} from '@ptp/registry'
import {ExternalDCIn, MovieShutterAngle, MovieShutterMode} from '@vendors/nikon/video-properties'
import {describe, expect, it, vi} from 'vitest'

function fixture() {
    const transport = {isLittleEndian: () => true, isConnected: () => true, getType: () => 'USB'}
    const camera = new NikonCamera(transport as any, new Logger({captureConsole: false, renderInTerminal: false}))
    const send = vi.spyOn(camera, 'send').mockResolvedValue({code: OK.code} as any)
    return {camera, send}
}

describe('Nikon video shutter and external power properties', () => {
    it('writes the complete extended shutter property code and signed 32-bit angle payload', async () => {
        const {camera, send} = fixture()
        await camera.set(MovieShutterMode, 'SHUTTER_ANGLE')
        await camera.set(MovieShutterAngle, 18000)
        expect(send.mock.calls.map(([operation, parameters, payload]) => ({
            operation: operation.code, parameters, payload: [...payload!],
        }))).toEqual([
            {operation: 0x943c, parameters: {DevicePropCode: 0x1d074}, payload: [2]},
            {operation: 0x943c, parameters: {DevicePropCode: 0x1d075}, payload: [0x50, 0x46, 0, 0]},
        ])
    })

    it('reports a rejected shutter write instead of treating command delivery as success', async () => {
        const {camera, send} = fixture()
        send.mockResolvedValue({code: 0x200f} as any)
        await expect(camera.set(MovieShutterAngle, 18000)).rejects.toThrow('write failed')
    })

    it('reads external power from the extended descriptor and refuses writes before sending', async () => {
        const {camera, send} = fixture()
        send.mockResolvedValue({code: OK.code, data: {currentValueDecoded: 'CONNECTED'}} as any)
        expect(await camera.get(ExternalDCIn)).toBe('CONNECTED')
        expect(send).toHaveBeenCalledWith(camera.registry.operations.GetDevicePropDescEx, {DevicePropCode: 0xd101})
        await expect(camera.set(ExternalDCIn, 'CONNECTED')).rejects.toThrow('not writable')
        expect(send).toHaveBeenCalledTimes(1)
    })

    it('preserves angle units and byte order without constraining the camera advertised choices', () => {
        for (const littleEndian of [true, false]) {
            const registry = createNikonRegistry(littleEndian)
            const codec = MovieShutterAngle.codec(registry)
            const bytes = codec.encode(17280)
            expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(0, littleEndian)).toBe(17280)
            expect(codec.decode(bytes).value).toBe(17280)
            expect(MovieShutterMode.codec(registry).decode(new Uint8Array([1])).value).toBe('SHUTTER_SPEED')
            expect(ExternalDCIn.codec(registry).decode(new Uint8Array([0])).value).toBe('NOT_CONNECTED')
        }
    })
})
