import { SonyWifiCamera, validateSonyWifiAuthentication, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { describe, expect, it } from 'vitest'

const authentication = {
    host: '192.0.2.98',
    mac: '0C:80:2F:A7:36:AD',
    username: 'operator',
    password: 'runtime-example',
    fingerprint: 'aabbcc',
}
function bridgeForProperties(properties: unknown[] = []) {
    const requests: Record<string, string>[] = []
    const bridge: SonySdkBridge = {
        request: async command => {
            requests.push(command)
            if (command.cmd === 'fingerprint') return { ok: true, fingerprint: 'aabbcc' }
            if (command.cmd === 'properties') return { ok: true, properties }
            return { ok: true }
        },
        close: async () => undefined,
    }
    return { bridge, requests }
}
describe('Sony SDK Wi-Fi camera', () => {
    it('opens official SDK USB preparation by serial without runtime Wi-Fi credentials', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connectUsb('../invalid')).rejects.toThrow('serial')
        await camera.connectUsb('D0CAA016393C')
        expect(requests).toEqual([{ cmd: 'connect', serial: 'D0CAA016393C' }])
        expect(camera.isConnected()).toBe(true)
        await camera.disconnect()
        expect(camera.isConnected()).toBe(false)
    })
    it('validates camera identity and runtime credentials without exposing them', () => {
        expect(() => validateSonyWifiAuthentication(authentication)).not.toThrow()
        expect(() => validateSonyWifiAuthentication({ ...authentication, host: '192.0.2.999' })).toThrow('IPv4')
        expect(() => validateSonyWifiAuthentication({ ...authentication, password: '' })).toThrow('runtime')
        expect(() => validateSonyWifiAuthentication({ ...authentication, password: '"comma,brace}' })).not.toThrow()
    })
    it('refuses a mismatched fingerprint before authentication', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connect({ ...authentication, fingerprint: 'different' })).rejects.toThrow('fingerprint')
        expect(requests.map(request => request.cmd)).toEqual(['fingerprint'])
        expect(camera.isConnected()).toBe(false)
    })
    it('pins the SDK-presented fingerprint after matching the operator fingerprint', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect({ ...authentication, fingerprint: 'AA:BB:CC' })
        expect(requests[1]).toMatchObject({ cmd: 'connect_wifi', ssh: '1', fingerprint: 'aabbcc' })
        expect(camera.isConnected()).toBe(true)
        await camera.disconnect()
        expect(camera.isConnected()).toBe(false)
    })
    it('preserves uint64 values and decodes signed SDK current values', async () => {
        const { bridge } = bridgeForProperties([
            { code: '0x104', type: 4, value: '9007199254740993', writable: true },
            { code: '0x101', type: 0x1002, value: '18446744073709551615', writable: true },
        ])
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        const properties = await camera.getSonyPropertyStates()
        expect(properties[0]!.value).toBe('9007199254740993')
        expect(properties[1]!.value).toBe('-1')
    })
    it('rejects readonly settings and inexact integers', async () => {
        const { bridge, requests } = bridgeForProperties([{ code: '0x104', type: 3, value: '100', writable: false }])
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await expect(camera.setSonyProperty('ISO', 200)).rejects.toThrow('read-only')
        expect(requests.some(request => request.cmd === 'set')).toBe(false)
    })
    it('uses SDK property IDs rather than USB PTP IDs', async () => {
        const { bridge, requests } = bridgeForProperties([{ code: '0x104', type: 3, value: '100', writable: true }])
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await camera.setSonyProperty('ISO', 200)
        expect(requests.at(-1)).toEqual({ cmd: 'set', code: '260', type: '3', value: '200' })
    })
    it('always releases body buttons through CameraButtonFunction', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await camera.sonyPressButton('menu', { holdMilliseconds: 30 })
        expect(requests.slice(-2)).toEqual([
            { cmd: 'set', code: '563', type: '16387', value: '393218' },
            { cmd: 'set', code: '563', type: '16387', value: '393217' },
        ])
        await expect(camera.sonyPressButton('menu', { holdMilliseconds: 0 })).rejects.toThrow('duration')
    })
    it('bounds focus position and durations before issuing controls', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await expect(camera.setSonyAfAreaPosition(640, 0)).rejects.toThrow('640')
        await expect(camera.autofocus(0)).rejects.toThrow('duration')
        await expect(camera.zoomSony('wide', 6000)).rejects.toThrow('duration')
        expect(requests).toHaveLength(2)
    })
    it('releases autofocus and stops zoom', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await camera.autofocus(30)
        await camera.zoomSony('wide', 30)
        expect(requests.slice(-4).map(request => [request.code, request.value])).toEqual([
            ['1', '2'],
            ['1', '1'],
            ['294', '-1'],
            ['294', '0'],
        ])
    })
    it('uses documented shutter and movie commands, without format/reset commands', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await camera.captureImage()
        await camera.startRecording()
        await camera.stopRecording()
        expect(
            requests.filter(request => request.cmd === 'command').map(request => [request.id, request.param])
        ).toEqual([
            ['0', '1'],
            ['0', '0'],
            ['1', '1'],
            ['1', '0'],
        ])
    })
})

it('matches a camera hex SHA-256 fingerprint to the public SDK base64 form', async () => {
    const requests: Record<string, string>[] = []
    const fingerprint = Buffer.alloc(32, 0x11).toString('base64')
    const bridge: SonySdkBridge = {
        request: async command => {
            requests.push(command)
            return command.cmd === 'fingerprint' ? { ok: true, fingerprint } : { ok: true }
        },
        close: async () => undefined,
    }
    const camera = new SonyWifiCamera(bridge)
    await camera.connect({ ...authentication, fingerprint: 'SHA256:' + '11'.repeat(32) })
    expect(requests[1]!.fingerprint).toBe(fingerprint)
    await camera.disconnect()
})

describe('Sony SDK connection startup retries', () => {
    it('retries a transient IP connection error with unchanged trusted credentials', async () => {
        const calls: Record<string, string>[] = []
        let attempts = 0
        const bridge: SonySdkBridge = {
            request: async command => {
                calls.push(command)
                if (command.cmd === 'fingerprint') return { ok: true, fingerprint: 'aabbcc' }
                if (command.cmd === 'connect_wifi' && attempts++ === 0)
                    throw new Error('Sony SDK command failed (SDK code 33282)')
                return { ok: true }
            },
            close: async () => undefined,
        }
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        expect(camera.isConnected()).toBe(true)
        expect(calls.filter(call => call.cmd === 'connect_wifi')).toHaveLength(2)
        expect(calls.filter(call => call.cmd === 'connect_wifi').map(call => call.password)).toEqual([
            authentication.password,
            authentication.password,
        ])
        expect(calls.some(call => call.cmd === 'disconnect')).toBe(true)
    })
    it('does not retry camera credential rejection', async () => {
        let attempts = 0
        const bridge: SonySdkBridge = {
            request: async command => {
                if (command.cmd === 'fingerprint') return { ok: true, fingerprint: 'aabbcc' }
                attempts++
                throw new Error('Sony SDK command failed (SDK code 33302)')
            },
            close: async () => undefined,
        }
        await expect(new SonyWifiCamera(bridge).connect(authentication)).rejects.toThrow('33302')
        expect(attempts).toBe(1)
    })
})

describe('Sony named SDK settings', () => {
    it('searches advertised settings by words and property code', async () => {
        const { bridge } = bridgeForProperties([
            { code: 264, type: 2, value: '0', writable: true },
            { code: 265, type: 2, value: '4', writable: false },
        ])
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        expect((await camera.getSonyCapabilities('white balance')).map(property => property.code)).toEqual([264])
        expect((await camera.getSonyCapabilities('265'))[0]!.writable).toBe(false)
        expect(await camera.getSonyCapabilities('unavailable')).toEqual([])
        expect((await camera.getSonyCapabilities('wb'))[0]!.code).toBe(264)
        expect((await camera.getSonyCapabilities('WhiteBalance'))[0]!.code).toBe(264)
    })
    it('resolves exact friendly names, validates choices, and confirms readback', async () => {
        let value = '0'
        const { bridge, requests } = bridgeForProperties()
        const original = bridge.request
        bridge.request = async command => {
            if (command.cmd === 'properties')
                return { properties: [{ code: 264, type: 2, value, writable: true, allowedValues: ['0', '17'] }] }
            if (command.cmd === 'set') value = command.value!
            return original(command)
        }
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        expect(await camera.setSonySetting('white balance', 17)).toMatchObject({
            before: { value: '0' },
            after: { value: '17' },
            verified: true,
        })
        await expect(camera.setSonySetting('white', 0)).rejects.toThrow('does not advertise')
        await expect(camera.setSonySetting('white balance', 999)).rejects.toThrow('does not offer')
        expect(requests.filter(command => command.cmd === 'set')).toHaveLength(1)
    })
})

it('does not report a verified setting when camera readback stays unchanged', async () => {
    const { bridge } = bridgeForProperties([
        { code: 264, type: 2, value: '0', writable: true, allowedValues: ['0', '17'] },
    ])
    const camera = new SonyWifiCamera(bridge)
    await camera.connect(authentication)
    await expect(camera.setSonySetting('WhiteBalance', 17)).rejects.toThrow('did not confirm')
}, 10000)

it('searches and writes familiar aliases when the SDK uses another advertised name', async () => {
    let value = '100'
    const { bridge } = bridgeForProperties()
    const original = bridge.request
    bridge.request = async command => {
        if (command.cmd === 'properties')
            return {
                properties: [
                    { code: 260, type: 3, value, writable: true, allowedValues: ['100', '3200'] },
                    { code: 256, type: 2, value: '1400', writable: true },
                ],
            }
        if (command.cmd === 'set') value = command.value!
        return original(command)
    }
    const camera = new SonyWifiCamera(bridge)
    await camera.connect(authentication)
    expect((await camera.getSonyCapabilities('gain'))[0]!.code).toBe(260)
    expect((await camera.getSonyCapabilities('f-stop'))[0]!.code).toBe(256)
    expect(await camera.setSonySetting('ISO', 3200)).toMatchObject({
        before: { name: 'IsoSensitivity' },
        after: { value: '3200' },
        verified: true,
    })
})

it('supports a RemoteTransfer USB observer for exact card capture verification', async () => {
    const { bridge, requests } = bridgeForProperties()
    const camera = new SonyWifiCamera(bridge)
    await camera.connectUsb('unit-test', { mode: 'remote-transfer' })
    expect(requests.at(-1)).toMatchObject({ cmd: 'connect', serial: 'unit-test', mode: 'remote-transfer' })
})


it('waits for the documented Sony contents-list processing status and preserves other errors',async()=>{
    let attempts=0
    const bridge:SonySdkBridge={request:async command=>{
        if(command.cmd==='recent_contents'){
            if(++attempts===1)throw new Error('Sony SDK command failed (SDK code 36101)')
            return {contents:[{id:123,files:[]}]}
        }
        return {ok:true}
    },close:async()=>undefined}
    const camera=new SonyWifiCamera(bridge)
    await camera.connectUsb('TEST_SERIAL')
    await expect(camera.getRecentSonyContents()).resolves.toEqual([{id:123,files:[]}])
    expect(attempts).toBe(2)
    bridge.request=async()=>{throw new Error('Sony SDK command failed (SDK code 36102)')}
    await expect(camera.getRecentSonyContents()).rejects.toThrow('36102')
})
