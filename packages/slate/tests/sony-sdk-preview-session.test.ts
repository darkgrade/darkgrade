import { SonyWifiCamera, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { describe, expect, it } from 'vitest'

function session(
    options: { monitoring?: boolean; failPreview?: boolean; failMonitoring?: boolean; failOsdOnce?: boolean } = {}
) {
    const commands: Record<string, string>[] = []
    let monitoring = false,
        osdFailed = false
    const format = (1n | (1n << 8n) | (3n << 16n) | (1n << 24n)).toString()
    const bridge: SonySdkBridge = {
        async request(command) {
            commands.push(command)
            if (command.cmd === 'fingerprint') return { fingerprint: 'trusted-example' }
            if (command.cmd === 'properties')
                return {
                    properties: [
                        { code: 709, type: 1, value: '1', writable: true },
                        ...(options.monitoring
                            ? [
                                  { code: 1928, type: 1, value: '1', writable: false },
                                  { code: 1927, type: 1, value: '0', writable: false },
                                  { code: 1955, type: 4, value: format, allowedValues: [format], writable: false },
                              ]
                            : []),
                    ],
                }
            if (command.cmd === 'monitoring_start') {
                monitoring = true
                return { ok: true }
            }
            if (command.cmd === 'liveview' && options.failPreview && (!monitoring || options.failMonitoring))
                throw new Error('No preview frame')
            if (command.cmd === 'osd' && options.failOsdOnce && !osdFailed) {
                osdFailed = true
                throw new Error('OSD temporarily unavailable')
            }
            return { ok: true, source: monitoring ? 'monitoring' : 'classic' }
        },
        async close() {},
    }
    return { camera: new SonyWifiCamera(bridge), commands }
}
describe('Sony preview session', () => {
    it('keeps an enabled OSD without rewriting or polling it for every frame', async () => {
        const { camera, commands } = session()
        await camera.connectUsb('example')
        await camera.captureSonyOsdImage('/tmp/first.png')
        await camera.captureSonyOsdImage('/tmp/second.png')
        expect(commands.map(command => command.cmd)).toEqual(['connect', 'properties', 'osd', 'osd'])
        await camera.disconnect()
    })
    it('rechecks OSD state after an image failure', async () => {
        const { camera, commands } = session({ failOsdOnce: true })
        await camera.connectUsb('example')
        await expect(camera.captureSonyOsdImage('/tmp/first.png')).rejects.toThrow('temporarily')
        await camera.captureSonyOsdImage('/tmp/second.png')
        expect(commands.filter(command => command.cmd === 'properties')).toHaveLength(2)
        await camera.disconnect()
    })
    it('preserves classic preview even when monitoring formats exist', async () => {
        const { camera, commands } = session({ monitoring: true })
        await camera.connect({
            host: '192.0.2.98',
            mac: '00:11:22:33:44:55',
            username: 'example',
            password: 'example',
            fingerprint: 'trusted-example',
        })
        expect(await camera.captureLiveView('/tmp/frame.jpg', { attempts: 2, monitoringFallback: true })).toMatchObject(
            { source: 'classic' }
        )
        expect(commands.some(command => command.cmd === 'monitoring_start')).toBe(false)
        await expect(camera.captureLiveView('/tmp/frame.jpg', { attempts: 0 })).rejects.toThrow('1–25')
        await camera.disconnect()
    })
    it('starts advertised JPEG monitoring only after classic delivery fails', async () => {
        const { camera, commands } = session({ monitoring: true, failPreview: true })
        await camera.connect({
            host: '192.0.2.98',
            mac: '00:11:22:33:44:55',
            username: 'example',
            password: 'example',
            fingerprint: 'trusted-example',
        })
        expect(await camera.captureLiveView('/tmp/frame.jpg', { attempts: 2, monitoringFallback: true })).toMatchObject(
            { source: 'monitoring' }
        )
        expect(commands.find(command => command.cmd === 'monitoring_start')).toEqual({
            cmd: 'monitoring_start',
            quality: '1',
        })
        await camera.disconnect()
    })
    it('stops failed monitoring and does not repeatedly delay subsequent controls', async () => {
        const { camera, commands } = session({ monitoring: true, failPreview: true, failMonitoring: true })
        await camera.connect({
            host: '192.0.2.98',
            mac: '00:11:22:33:44:55',
            username: 'example',
            password: 'example',
            fingerprint: 'trusted-example',
        })
        await expect(camera.captureLiveView('/tmp/frame.jpg', { monitoringFallback: true })).rejects.toThrow(
            'No preview'
        )
        await expect(camera.captureLiveView('/tmp/frame.jpg', { monitoringFallback: true })).rejects.toThrow(
            'No preview'
        )
        expect(commands.filter(command => command.cmd === 'monitoring_start')).toHaveLength(1)
        expect(commands.some(command => command.cmd === 'monitoring_stop')).toBe(true)
        await camera.disconnect()
    })
})
