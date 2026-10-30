import { expect, it } from 'vitest'
import { Camera } from '@camera/index'
import { withNikonRawCompression } from '@vendors/nikon/raw-capture'

function fixture(options: { readonly?: boolean; unsupported?: boolean; lostWrite?: boolean; restoreFailure?: boolean } = {}) {
    let value = 3
    const writes: number[] = []
    const camera: any = {
        registry: { properties: { NikonRawCompression: { code: 0xd016 } }, operations: { GetDevicePropDescEx: {} } },
        getVendorPropertyCodes: async () => [0xd016],
        send: async () => ({ code: 0x2001, data: {
            formFlag: 2, supportedValuesRaw: options.unsupported ? [3, 4] : [0, 3, 4],
            currentValueRaw: value, getSet: options.readonly ? 'GET' : 'GET_SET',
        } }),
        set: async (_: unknown, next: number) => {
            writes.push(next)
            value = next
            if (next === 0 && options.lostWrite) throw new Error('write acknowledgement lost')
            if (next === 3 && options.restoreFailure) throw new Error('restore failed')
        },
        get: async () => value,
    }
    return { camera, writes, value: () => value }
}

it.each([false, true])('holds lossless RAW through capture and restores after success/failure (%s)', async failed => {
    const f = fixture()
    const capture = withNikonRawCompression(f.camera, 'lossless', async () => {
        expect(f.value()).toBe(0)
        if (failed) throw new Error('shutter failed')
        return { bytes: 100 }
    })
    if (failed) await expect(capture).rejects.toThrow('shutter failed')
    else await expect(capture).resolves.toEqual({ bytes: 100 })
    expect(f.writes).toEqual([0, 3])
})

it('restores an uncertain write and preserves both capture and restoration errors', async () => {
    const lost = fixture({ lostWrite: true })
    await expect(withNikonRawCompression(lost.camera, 'lossless', async () => { throw new Error('must not capture') }))
        .rejects.toThrow('write acknowledgement lost')
    expect(lost.writes).toEqual([0, 3])
    const broken = fixture({ restoreFailure: true })
    await expect(withNikonRawCompression(broken.camera, 'lossless', async () => { throw new Error('shutter failed') }))
        .rejects.toThrow('shutter failed; restoring Nikon RAW compression: Error: restore failed')
})

it.each([{ readonly: true }, { unsupported: true }])('never releases for an unavailable lossless setting (%j)', async options => {
    const f = fixture(options)
    await expect(withNikonRawCompression(f.camera, 'lossless', async () => { throw new Error('must not capture') }))
        .rejects.toThrow('no shutter command sent')
    expect(f.writes).toEqual([])
})

it('ordinary capture leaves RAW settings alone and other vendors reject the option', async () => {
    expect(await withNikonRawCompression({} as any, undefined, async () => 'unchanged')).toBe('unchanged')
    const camera = new Camera({ vendorId: 0x04a9, transport: { isLittleEndian: () => true } as any,
        logger: { captureConsole: false, renderInTerminal: false } })
    await expect(camera.captureImage({ rawCompression: 'lossless' })).rejects.toThrow('requires a Nikon')
})
