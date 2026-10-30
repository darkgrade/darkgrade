import { describe, expect, it, vi } from 'vitest'
import { SonyWifiCamera } from '@vendors/sony/sdk-camera'

function fixture(movie = false) {
    const values: Record<string, string> = {
        StillImageStoreDestination: '1', PriorityKeySettings: '1',
        ExposureProgramMode: movie ? '32853' : '1', FileType: '1', RAW_J_PC_Save_Image: '0', FocusMode: '3',
    }
    const request = vi.fn(async (command: Record<string, string>) =>
        command.cmd === 'wait_download' ? { files: [{ filename: 'fresh.jpg' }] } : {})
    const camera = new SonyWifiCamera({ request, close: async () => {} })
    vi.spyOn(camera, 'getSonyProperty').mockImplementation(async (name: any) => ({
        name, code: 261, type: 3, value: values[name]!, writable: true,
        allowedValues: name === 'ExposureProgramMode'
            ? values.PriorityKeySettings === '2' ? ['1', '32853'] : ['32853'] : undefined,
    }))
    vi.spyOn(camera, 'setSonySetting').mockImplementation(async (name: any, value: any) => {
        values[name] = String(value)
        return { verified: true } as any
    })
    return { camera, values, request }
}

describe('Sony SDK still capture', () => {
    it('holds S1 through S2 and restores autofocus after an explicit focus bypass', async () => {
        vi.useFakeTimers()
        try {
            const { camera, values, request } = fixture()
            await camera.connectUsb('test')
            request.mockImplementation(async command => {
                if (command.cmd === 'command') expect(values.FocusMode).toBe('1')
                return command.cmd === 'wait_download' ? { files: [{ filename: 'fresh.jpg' }] } : {}
            })
            const pending = camera.captureAndDownload('/tmp/photos', { autofocus: false })
            await vi.runAllTimersAsync(); await pending
            expect(values.FocusMode).toBe('3')
            expect(request.mock.calls.map(([command]) => command).filter(command => command.cmd === 'set' || command.cmd === 'command'))
                .toEqual([{cmd:'set',code:'1',type:'2',value:'2'},{cmd:'command',id:'0',param:'1'},
                    {cmd:'command',id:'0',param:'0'},{cmd:'set',code:'1',type:'2',value:'1'}])
        } finally { vi.useRealTimers() }
    })
    it('does not treat a still Auto exposure program as a movie program', async () => {
        vi.useFakeTimers()
        try {
            const { camera, values } = fixture()
            values.ExposureProgramMode = '32768'
            await camera.connectUsb('test')
            const pending = camera.captureAndDownload('/tmp/photos')
            await vi.runAllTimersAsync(); await pending
            expect(camera.setSonySetting).not.toHaveBeenCalledWith('ExposureProgramMode', expect.anything())
            expect(values.ExposureProgramMode).toBe('32768')
        } finally { vi.useRealTimers() }
    })
    it('selects an advertised still mode after acquiring PC priority and restores the movie mode', async () => {
        vi.useFakeTimers()
        try {
            const { camera, values, request } = fixture(true)
            await camera.connectUsb('test')
            request.mockImplementation(async command => {
                if (command.cmd === 'command') expect(values.ExposureProgramMode).toBe('1')
                return command.cmd === 'wait_download' ? { files: [{ filename: 'fresh.jpg' }] } : {}
            })
            const pending = camera.captureAndDownload('/tmp/photos')
            await vi.runAllTimersAsync()
            expect(await pending).toMatchObject({ files: [{ filename: 'fresh.jpg' }] })
            expect(values).toMatchObject({ ExposureProgramMode: '32853', PriorityKeySettings: '1', StillImageStoreDestination: '1' })
        } finally { vi.useRealTimers() }
    })

    it('preserves capture failure when restoration also fails and attempts every restoration', async () => {
        vi.useFakeTimers()
        try {
            const { camera, values, request } = fixture(true)
            await camera.connectUsb('test')
            request.mockImplementation(async command => {
                if (command.cmd === 'wait_download') throw new Error('No new photo')
                return {}
            })
            camera.setSonySetting = vi.fn(async (name: any, value: any) => {
                if (name === 'ExposureProgramMode' && String(value) === '32853') throw new Error('Movie restore rejected')
                values[name] = String(value)
                return { verified: true } as any
            })
            const pending = expect(camera.captureAndDownload('/tmp/photos')).rejects.toThrow(/No new photo.*Movie restore rejected/)
            await vi.runAllTimersAsync()
            await pending
            expect(values.PriorityKeySettings).toBe('1')
        } finally { vi.useRealTimers() }
    })

    it('restores the original mode even when changing mode fails after the camera accepts it', async () => {
        vi.useFakeTimers()
        try {
            const { camera, values, request } = fixture(true)
            await camera.connectUsb('test')
            const set = camera.setSonySetting
            camera.setSonySetting = vi.fn(async (name: any, value: any) => {
                const result = await set(name, value)
                if (name === 'ExposureProgramMode' && String(value) === '1') throw new Error('Readback timed out')
                return result
            })
            await expect(camera.captureAndDownload('/tmp/photos')).rejects.toThrow('Readback timed out')
            expect(values.ExposureProgramMode).toBe('32853')
            expect(request.mock.calls.some(([command]) => command.cmd === 'command')).toBe(false)
        } finally { vi.useRealTimers() }
    })
})
