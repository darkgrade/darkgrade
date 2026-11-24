import { expect, it, vi } from 'vitest'
import { NikonCamera } from '@camera/nikon-camera'
import { Logger } from '@core/logger'

function fixture(recording = false, reject = false) {
    const camera = new NikonCamera({ isLittleEndian: () => true } as any,
        new Logger({ captureConsole: false, renderInTerminal: false }))
    let selector = 'VIDEO', pipeline: string | undefined = 'VIDEO', quality = 7
    camera.get = vi.fn(async property => property.name === 'LiveViewSelector' ? selector
        : property.name === 'LiveViewStatus' ? (pipeline ? 'ON' : 'OFF')
        : recording ? 'alreadyRecording' : 'none') as any
    camera.set = vi.fn(async (property, value) => {
        if (property.name === 'LiveViewSelector') selector = String(value)
    }) as any
    camera.getStandardPropertyStates = vi.fn(async () => [{
        code: 0x5004, codeHex: '0x5004', name: 'CompressionSetting',
        writable: selector === 'PHOTO', allowedValues: [4, 7], value: quality,
    }]) as any
    camera.send = vi.fn(async (operation, _parameters, data) => {
        if (operation.name === 'EndLiveView') pipeline = undefined
        if (operation.name === 'StartLiveView') pipeline = selector
        if (operation.name === 'SetDevicePropValue') {
            if (reject) return { code: 0x200f }
            quality = data![0]
        }
        return { code: 0x2001 }
    }) as any
    return { camera, state: () => ({ selector, pipeline, quality }) }
}

it('sets Nikon JPEG quality through temporary Photo mode and restores video live view', async () => {
    const { camera, state } = fixture()
    await camera.setStandardProperty('CompressionSetting', '4')
    expect(state()).toEqual({ selector: 'VIDEO', pipeline: 'VIDEO', quality: 4 })
})

it('restores video mode when Nikon rejects the photo setting', async () => {
    const { camera, state } = fixture(false, true)
    await expect(camera.setStandardProperty('CompressionSetting', '4')).rejects.toThrow('0x200f')
    expect(state()).toEqual({ selector: 'VIDEO', pipeline: 'VIDEO', quality: 7 })
})

it('refuses a photo-quality change while Nikon is recording', async () => {
    const { camera, state } = fixture(true)
    await expect(camera.setStandardProperty('CompressionSetting', '4')).rejects.toThrow('active recording')
    expect(camera.set).not.toHaveBeenCalled()
    expect(state().quality).toBe(7)
})
