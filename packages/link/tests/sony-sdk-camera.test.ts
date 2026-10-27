import {
    SonyWifiCamera,
    validateSonyWifiAuthentication,
    type SonyBluetoothDirectAuthentication,
    type SonySdkBridge,
} from '@vendors/sony/sdk-camera'
import { describe, expect, it, vi } from 'vitest'
import {repairSonyRecordingIndex} from '@vendors/sony/media-index'

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

describe('Sony media-index pagination recovery',()=>{
 function fixture(count=100){
  const state={count,recording:false,slot:'1',stopFails:false}
  const camera={
   getRecentSonyContents:vi.fn(async()=>{if(state.count>=100&&(state.count-1)%99===0)throw new Error('Sony SDK command failed (SDK code 36102)');return Array.from({length:state.count},(_,id)=>({id:id+1,files:[{name:`clip-${id+1}.MP4`,bytes:100}]}))}),
   getSonyProperty:vi.fn(async(name:string)=>({value:name==='RecordingState'?(state.recording?'1':'0'):name==='Movie_RecordingMedia'?state.slot:name.endsWith('_Status')?'0':'3600'})),
   startRecording:vi.fn(async()=>{state.recording=true}),
   stopRecording:vi.fn(async()=>{if(!state.stopFails){if(state.recording)state.count++;state.recording=false}}),
   refreshConnection:vi.fn(async()=>{expect(state.recording).toBe(false)}),
  };return {state,camera}
 }
 it.each([[100,1],[99,2],[199,1],[198,2],[298,1]])('repairs %i contents with %i bounded maintenance recordings',async(count,expected)=>{
  vi.useFakeTimers();try{
   const f=fixture(count),progress=vi.fn(),pending=repairSonyRecordingIndex(f.camera,progress)
   await vi.runAllTimersAsync();const result=await pending
   expect(result.repaired).toBe(true);expect(result.maintenanceRecordings).toBe(expected)
   expect(result.contents).toHaveLength(count+expected)
   expect(f.camera.startRecording).toHaveBeenCalledTimes(expected);expect(f.camera.stopRecording).toHaveBeenCalledTimes(expected);expect(f.camera.refreshConnection).toHaveBeenCalledTimes(expected)
   expect(result.contents.slice(0,count).map(c=>c.id)).toEqual(Array.from({length:count},(_,id)=>id+1));expect(progress).toHaveBeenCalledTimes(expected)
  }finally{vi.useRealTimers()}
 })
 it.each([0,1,98,101,197,200])('does not create media for an ordinary readable index of %i contents',async count=>{
  const f=fixture(count);expect((await repairSonyRecordingIndex(f.camera)).repaired).toBe(false);expect(f.camera.startRecording).not.toHaveBeenCalled();expect(f.camera.refreshConnection).not.toHaveBeenCalled()
 })
 it('does not convert network errors into a maintenance recording',async()=>{
  const f=fixture();f.camera.getRecentSonyContents.mockRejectedValue(new Error('Network unavailable'))
  await expect(repairSonyRecordingIndex(f.camera)).rejects.toThrow('Network unavailable');expect(f.camera.startRecording).not.toHaveBeenCalled()
 })
 it('bounds maintenance recordings when an index fault persists',async()=>{
  vi.useFakeTimers();try{
   const f=fixture();f.camera.getRecentSonyContents.mockRejectedValue(new Error('Sony SDK command failed (SDK code 36102)'))
   const rejected=expect(repairSonyRecordingIndex(f.camera)).rejects.toThrow('two attempts')
   await vi.runAllTimersAsync();await rejected;expect(f.camera.startRecording).toHaveBeenCalledTimes(2);expect(f.camera.stopRecording).toHaveBeenCalledTimes(2)
  }finally{vi.useRealTimers()}
 })
 it.each(['recording','slot'])('refuses repair for unsafe %s state',async(kind)=>{
  const f=fixture();if(kind==='recording')f.state.recording=true;else f.state.slot='2'
  await expect(repairSonyRecordingIndex(f.camera)).rejects.toThrow();expect(f.camera.startRecording).not.toHaveBeenCalled();expect(f.camera.stopRecording).not.toHaveBeenCalled();expect(f.camera.refreshConnection).not.toHaveBeenCalled()
 })
 it('preserves the connection when stopping a maintenance recording is unconfirmed',async()=>{
  vi.useFakeTimers();try{
   const f=fixture();f.state.stopFails=true;const pending=expect(repairSonyRecordingIndex(f.camera)).rejects.toThrow('stop is unconfirmed')
   await vi.runAllTimersAsync();await pending;expect(f.camera.refreshConnection).not.toHaveBeenCalled();expect(f.camera.startRecording).toHaveBeenCalledTimes(1)
  }finally{vi.useRealTimers()}
 })
 it('a read-only SDK listing never starts recording to hide a parse failure',async()=>{
  const {bridge,requests}=bridgeForProperties();const request=bridge.request;bridge.request=async command=>{if(command.cmd==='recent_contents')throw new Error('Sony SDK command failed (SDK code 36102)');return request(command)}
  const camera=new SonyWifiCamera(bridge);await camera.connectUsb('test');await expect(camera.getRecentSonyContents({all:true})).rejects.toThrow('36102')
  expect(requests.some(r=>r.cmd==='command')).toBe(false)
 })
 it.each(['usb','wifi','direct'])('refreshes only its existing %s transport',async transport=>{
  const {bridge,requests}=bridgeForProperties([{code:'0x705',type:2,value:'0',writable:false}]);const camera=new SonyWifiCamera(bridge)
  const connect=()=>transport==='usb'?camera.connectUsb('test',{mode:'remote-transfer'}):transport==='wifi'?camera.connect(authentication,{mode:'remote-transfer'}):camera.connectBluetoothDirect({host:'192.0.2.98',mac:'0C:80:2F:A7:36:AD',model:'ILME-FX2',bluetoothAddress:'0C:80:2F:A7:36:AE'},{mode:'remote-transfer'})
  await connect();const original=requests.find(r=>r.cmd.startsWith('connect'))!;await camera.refreshConnection()
  expect(requests.filter(r=>r.cmd.startsWith('connect'))).toEqual([original,original]);expect(requests.some(r=>r.cmd==='disconnect')).toBe(true);expect(camera.isConnected()).toBe(true)
 })
})

describe('Sony SDK Bluetooth Direct connection', () => {
    const directAuthentication: SonyBluetoothDirectAuthentication = {
        host: '192.0.2.98',
        mac: '0C:80:2F:A7:36:AD',
        model: 'ILME-FX2',
        bluetoothAddress: '0C:80:2F:A7:36:AE',
    }

    it.each([undefined, 'remote', 'remote-transfer'] as const)(
        'uses only the explicit Bluetooth Direct command with mode %s',
        async mode => {
            const { bridge, requests } = bridgeForProperties()
            const camera = new SonyWifiCamera(bridge)
            await camera.connectBluetoothDirect(directAuthentication, { mode })
            expect(requests).toEqual([
                {
                    cmd: 'connect_bluetooth_direct',
                    ip: directAuthentication.host,
                    mac: directAuthentication.mac,
                    ssh: '0',
                    model: directAuthentication.model,
                    bluetoothAddress: directAuthentication.bluetoothAddress,
                    ...(mode ? { mode } : {}),
                },
            ])
            expect(camera.isConnected()).toBe(true)
        }
    )

    it.each([
        undefined,
        {},
        { ...directAuthentication, host: '192.0.2.999' },
        { ...directAuthentication, host: 'camera.local' },
        { ...directAuthentication, mac: 'invalid' },
        { ...directAuthentication, bluetoothAddress: undefined },
        { ...directAuthentication, bluetoothAddress: 'invalid' },
        { ...directAuthentication, model: undefined },
        { ...directAuthentication, model: 'unknown' },
    ])('rejects invalid or missing identity before requesting the bridge: %j', async identity => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(
            camera.connectBluetoothDirect(identity as SonyBluetoothDirectAuthentication)
        ).rejects.toThrow()
        expect(requests).toEqual([])
        expect(camera.isConnected()).toBe(false)
    })

    it('rejects an unsupported runtime mode without contacting the bridge', async () => {
        const { bridge, requests } = bridgeForProperties()
        await expect(
            new SonyWifiCamera(bridge).connectBluetoothDirect(directAuthentication, { mode: 'invalid' as 'remote' })
        ).rejects.toThrow('mode')
        expect(requests).toEqual([])
    })

    it('keeps a failed direct connection disconnected without authentication fallback', async () => {
        const { bridge, requests } = bridgeForProperties()
        const request = bridge.request
        bridge.request = async command => {
            await request(command)
            throw new Error('Direct connection refused')
        }
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connectBluetoothDirect(directAuthentication)).rejects.toThrow('refused')
        expect(requests.map(command => command.cmd)).toEqual(['connect_bluetooth_direct'])
        expect(camera.isConnected()).toBe(false)
    })

    it('supports normal property writes and disconnect cleanup after direct connection', async () => {
        const { bridge, requests } = bridgeForProperties([
            { code: '0x100', type: 2, value: '160', writable: true },
        ])
        let closed = false
        bridge.close = async () => {
            closed = true
        }
        const camera = new SonyWifiCamera(bridge)
        await camera.connectBluetoothDirect(directAuthentication)
        await camera.setSonyProperty('Aperture', 200)
        expect(requests.at(-1)).toEqual({ cmd: 'set', code: '256', type: '2', value: '200' })
        await expect(camera.connectBluetoothDirect(directAuthentication)).rejects.toThrow('already connected')
        await camera.disconnect()
        expect(requests.at(-1)).toEqual({ cmd: 'disconnect' })
        expect(closed).toBe(true)
        expect(camera.isConnected()).toBe(false)
        await expect(camera.setSonyProperty('Aperture', 160)).rejects.toThrow('not connected')
    })

    it('closes the bridge even if disconnect fails', async () => {
        const { bridge } = bridgeForProperties()
        let closed = false
        const camera = new SonyWifiCamera(bridge)
        await camera.connectBluetoothDirect(directAuthentication)
        bridge.request = async () => {
            throw new Error('Disconnect failed')
        }
        bridge.close = async () => {
            closed = true
        }
        await expect(camera.disconnect()).rejects.toThrow('Disconnect failed')
        expect(closed).toBe(true)
        expect(camera.isConnected()).toBe(false)
    })
})

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
    it.each(['ILCE-6700', 'ILME-FX2'] as const)('uses %s for fingerprint and connection identity', async model => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await camera.connect({ ...authentication, model })
        expect(requests[0]).toMatchObject({ cmd: 'fingerprint', model })
        expect(requests[1]).toMatchObject({ cmd: 'connect_wifi', model })
    })
    it('keeps the existing bridge contract when the model is omitted', async () => {
        const { bridge, requests } = bridgeForProperties()
        await new SonyWifiCamera(bridge).connect(authentication)
        expect(requests[0]).not.toHaveProperty('model')
        expect(requests[1]).not.toHaveProperty('model')
    })
    it('rejects an unknown explicit model before contacting the camera', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connect({ ...authentication, model: 'unknown' as 'ILME-FX2' })).rejects.toThrow('model')
        expect(requests).toEqual([])
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

it('finds advertised exposure mode aliases and labels their Auto and Manual choices', async () => {
    const { bridge } = bridgeForProperties([310, 311, 312].map(code => ({
        code, type: 1, value: '1', writable: true, allowedValues: ['1', '2'],
    })))
    const camera = new SonyWifiCamera(bridge)
    await camera.connectUsb('unit-test')
    expect((await camera.getSonyCapabilities('ISO')).map(property => property.code)).toEqual([312])
    expect((await camera.getSonyCapabilities('gain')).map(property => property.code)).toEqual([312])
    for (const alias of ['ApertureMode', 'ShutterMode', 'IsoMode'] as const) {
        expect((await camera.getSonyProperty(alias)).choices).toEqual([
            { value: '1', label: 'Auto' }, { value: '2', label: 'Manual' },
        ])
    }
})

it('requests the complete contents index for recording and refuses a truncated reply',async()=>{
 const {bridge,requests}=bridgeForProperties(),camera=new SonyWifiCamera(bridge)
 await camera.connectUsb('TEST_SERIAL')
 bridge.request=async command=>{requests.push(command);return {contents:[],truncated:true}}
 await expect(camera.getRecentSonyContents({all:true})).rejects.toThrow('incomplete content index')
 expect(requests.at(-1)).toEqual({cmd:'recent_contents',scope:'all'})
 await expect(camera.getRecentSonyContents()).resolves.toEqual([])
})

it('requires explicit complete-index evidence from the native bridge',async()=>{
 const {bridge}=bridgeForProperties(),camera=new SonyWifiCamera(bridge)
 await camera.connectUsb('TEST_SERIAL')
 bridge.request=async()=>({contents:[]})
 await expect(camera.getRecentSonyContents({all:true})).rejects.toThrow('rebuild the SDK bridge')
 bridge.request=async()=>({contents:[],truncated:false,totalCount:0})
 await expect(camera.getRecentSonyContents({all:true})).resolves.toEqual([])
})

it('marks only exhausted contents-processing errors for one stopped-transfer reconnect',async()=>{
 vi.useFakeTimers()
 try{
  const bridge:SonySdkBridge={request:async command=>{if(command.cmd==='recent_contents')throw new Error('Sony SDK command failed (SDK code 36101)');return {ok:true}},close:async()=>{}}
  const camera=new SonyWifiCamera(bridge);await camera.connectUsb('TEST_SERIAL')
  const pending=expect(camera.getRecentSonyContents({all:true})).rejects.toMatchObject({retryableTransfer:true,message:expect.stringContaining('original footage remains on the card')})
  await vi.advanceTimersByTimeAsync(15250);await pending
  bridge.request=async()=>{throw new Error('Sony SDK command failed (SDK code 36102)')}
  const error=await camera.getRecentSonyContents().catch(error=>error)
  expect(error.message).toContain('36102');expect(error.retryableTransfer).not.toBe(true)
 }finally{vi.useRealTimers()}
})
