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
const directAuthentication: SonyBluetoothDirectAuthentication = {
    host: '192.0.2.98',
    mac: '0C:80:2F:A7:36:AD',
    model: 'ILME-FX2',
    bluetoothAddress: '0C:80:2F:A7:36:AE',
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
  const camera=new SonyWifiCamera(bridge);await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' });await expect(camera.getRecentSonyContents({all:true})).rejects.toThrow('36102')
  expect(requests.some(r=>r.cmd==='command')).toBe(false)
 })
 it('returns a successful snapshot with a refresh hint instead of replacing it with an old error',async()=>{
  let warning=36102
  const {bridge}=bridgeForProperties();const request=bridge.request;bridge.request=async command=>command.cmd==='recent_contents'?{ok:true,totalCount:1,truncated:false,indexWarningCode:warning,contents:[{id:1}]}:request(command)
  const camera=new SonyWifiCamera(bridge);await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
  expect(await camera.getRecentSonyContents({all:true})).toEqual([{id:1}]);expect(camera.shouldRefreshMediaIndex()).toBe(true)
  warning=0;await camera.getRecentSonyContents({all:true});expect(camera.shouldRefreshMediaIndex()).toBe(false)
 })
 it.each(['wifi','direct'])('refreshes only its existing %s transport',async transport=>{
  const {bridge,requests}=bridgeForProperties([{code:'0x705',type:2,value:'0',writable:false}]);const camera=new SonyWifiCamera(bridge)
  const connect=()=>transport==='wifi'?camera.connect(authentication,{mode:'remote-transfer'}):camera.connectBluetoothDirect({host:'192.0.2.98',mac:'0C:80:2F:A7:36:AD',model:'ILME-FX2',bluetoothAddress:'0C:80:2F:A7:36:AE'},{mode:'remote-transfer'})
  await connect();const original=requests.find(r=>r.cmd.startsWith('connect'))!;await camera.refreshConnection()
  expect(requests.filter(r=>r.cmd.startsWith('connect'))).toEqual([original,original]);expect(requests.some(r=>r.cmd==='disconnect')).toBe(true);expect(camera.isConnected()).toBe(true)
 })
})

describe('Sony SDK Bluetooth Direct connection', () => {

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
        ...[
            undefined,
            {},
            { ...directAuthentication, host: '192.0.2.999' },
            { ...directAuthentication, host: 'camera.local' },
            { ...directAuthentication, mac: 'invalid' },
            { ...directAuthentication, bluetoothAddress: undefined },
            { ...directAuthentication, bluetoothAddress: 'invalid' },
            { ...directAuthentication, model: undefined },
            { ...directAuthentication, model: 'unknown' },
        ].map(identity => ({ identity, options: undefined })),
        { identity: directAuthentication, options: { mode: 'invalid' as 'remote' } },
    ])('rejects an invalid identity or runtime mode before requesting the bridge: %j', async ({ identity, options }) => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(
            camera.connectBluetoothDirect(identity as SonyBluetoothDirectAuthentication, options)
        ).rejects.toThrow()
        expect(requests).toEqual([])
        expect(camera.isConnected()).toBe(false)
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
        const { bridge, requests } = bridgeForProperties([{ code: '0x100', type: 2, value: '160', writable: true }])
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
    it('keeps SDK recording failure distinct from native PTP Starting and never assumes idle', async () => {
        const state = { code: 1797, type: 2, value: '2', writable: false }
        const { bridge, requests } = bridgeForProperties([state])
        const camera = new SonyWifiCamera(bridge)
        await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
        expect(await camera.getRecordingState()).toBe('unknown')
        await expect(camera.startRecording()).rejects.toThrow('idle before starting')
        expect(requests.some(command => command.cmd === 'command')).toBe(false)
        const request = bridge.request
        bridge.request = async command => {
            if (command.cmd === 'command' && command.id === '1' && command.param === '0') state.value = '0'
            return request(command)
        }
        await camera.stopRecording()
        expect(requests.filter(command => command.cmd === 'command')).toEqual([{ cmd: 'command', id: '1', param: '0' }])
        expect(await camera.getRecordingState()).toBe('idle')
        await camera.disconnect()
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
    it.each([
        ['Wi-Fi', 'ILCE-6700', true],
        ['Wi-Fi', 'ILME-FX2', true],
        ['Wi-Fi', 'ILCE-7M4', false],
        ['Wi-Fi', 'ZV-E1', false],
        ['Wi-Fi', undefined, false],
        ['Bluetooth Direct', 'ILME-FX2', true],
        ['Bluetooth Direct', 'ILCE-7M4', false],
    ] as const)('over %s attempts model %s for every connection command (verified: %s)', async (transport, model, verified) => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        const connected = transport === 'Wi-Fi'
            ? await camera.connect(model ? { ...authentication, model } : authentication)
            : await camera.connectBluetoothDirect({ ...directAuthentication, model: model! })
        expect(connected).toEqual(model ? { model, verified } : { verified })
        const commands = transport === 'Wi-Fi' ? ['fingerprint', 'connect_wifi'] : ['connect_bluetooth_direct']
        commands.forEach((cmd, index) => {
            expect(requests[index]).toMatchObject({ cmd, ...(model ? { model } : {}) })
            if (!model) expect(requests[index]).not.toHaveProperty('model')
        })
    })
    it('surfaces a refused unvalidated body as the ordinary connection failure', async () => {
        const { bridge, requests } = bridgeForProperties()
        const request = bridge.request.bind(bridge)
        bridge.request = async command => {
            if (command.cmd === 'connect_wifi') throw new Error('SDK code 33281')
            return request(command)
        }
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connect({ ...authentication, model: 'ILCE-7M4' })).rejects.toThrow('33281')
        expect(requests.map(request => request.cmd)).toEqual(['fingerprint'])
        expect(camera.isConnected()).toBe(false)
    })
    it('rejects an unknown explicit model before contacting the camera', async () => {
        const { bridge, requests } = bridgeForProperties()
        const camera = new SonyWifiCamera(bridge)
        await expect(camera.connect({ ...authentication, model: 'unknown' as 'ILME-FX2' })).rejects.toThrow('model')
        expect(requests).toEqual([])
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
        const state = { code: 1797, type: 2, value: '0', writable: false }
        const { bridge, requests } = bridgeForProperties([state])
        const request = bridge.request.bind(bridge)
        bridge.request = async command => {
            if (command.cmd === 'command' && command.id === '1') state.value = command.param
            return request(command)
        }
        const camera = new SonyWifiCamera(bridge)
        await camera.connect(authentication)
        await camera.captureImage()
        await camera.startRecording()
        await camera.stopRecording()
        expect(
            requests.filter(request => request.cmd === 'command').map(request => [request.id, request.param])
        ).toEqual([['0', '1'], ['0', '0'], ['1', '1'], ['1', '0']])
    })
})

it.each([
    ['AA:BB:CC', 'aabbcc', 'aabbcc'],
    ['SHA256:' + '11'.repeat(32), Buffer.alloc(32, 0x11).toString('base64'), Buffer.alloc(32, 0x11).toString('base64')],
])('matches operator fingerprint %s and pins the SDK-presented form', async (operatorFingerprint, presented, pinned) => {
    const requests: Record<string, string>[] = []
    const bridge: SonySdkBridge = {
        request: async command => {
            requests.push(command)
            return command.cmd === 'fingerprint' ? { ok: true, fingerprint: presented } : { ok: true }
        },
        close: async () => undefined,
    }
    const camera = new SonyWifiCamera(bridge)
    await camera.connect({ ...authentication, fingerprint: operatorFingerprint })
    expect(requests[1]).toMatchObject({ cmd: 'connect_wifi', ssh: '1', fingerprint: pinned })
    expect(camera.isConnected()).toBe(true)
    await camera.disconnect()
    expect(camera.isConnected()).toBe(false)
})

describe('Sony SDK connection startup retries', () => {
    it.each([
        ['retries a transient IP error', 33282, 2],
        ['does not retry camera credential rejection', 33302, 1],
    ] as const)('%s (SDK code %i) with unchanged trusted credentials', async (_case, code, attempts) => {
        const calls: Record<string, string>[] = []
        const bridge: SonySdkBridge = {
            request: async command => {
                calls.push(command)
                if (command.cmd === 'fingerprint') return { ok: true, fingerprint: 'aabbcc' }
                if (command.cmd === 'connect_wifi' && calls.filter(call => call.cmd === 'connect_wifi').length === 1)
                    throw new Error(`Sony SDK command failed (SDK code ${code})`)
                return { ok: true }
            },
            close: async () => undefined,
        }
        const camera = new SonyWifiCamera(bridge)
        const connected = camera.connect(authentication)
        if (attempts === 1) await expect(connected).rejects.toThrow(String(code))
        else await connected
        expect(camera.isConnected()).toBe(attempts > 1)
        const connects = calls.filter(call => call.cmd === 'connect_wifi')
        expect(connects.map(call => call.password)).toEqual(Array(attempts).fill(authentication.password))
        if (attempts > 1) expect(calls.some(call => call.cmd === 'disconnect')).toBe(true)
    })
})

describe('Sony named SDK settings', () => {
    const whiteBalanceAndFocus = [
        { code: 264, type: 2, value: '0', writable: true },
        { code: 265, type: 2, value: '4', writable: false },
    ]
    const isoAndAperture = [
        { code: 260, type: 3, value: '100', writable: true },
        { code: 256, type: 2, value: '1400', writable: true },
    ]
    const exposureModes = [310, 311, 312].map(code => ({ code, type: 1, value: '1', writable: true, allowedValues: ['1', '2'] }))
    it.each([
        [whiteBalanceAndFocus, 'white balance', [264]],
        [whiteBalanceAndFocus, 'wb', [264]],
        [whiteBalanceAndFocus, 'WhiteBalance', [264]],
        [whiteBalanceAndFocus, '265', [265]],
        [whiteBalanceAndFocus, 'unavailable', []],
        [isoAndAperture, 'gain', [260]],
        [isoAndAperture, 'f-stop', [256]],
        [exposureModes, 'ISO', [312]],
        [exposureModes, 'gain', [312]],
    ])('searches advertised settings %#: %s finds %j', async (properties, query, codes) => {
        const camera = new SonyWifiCamera(bridgeForProperties(properties).bridge)
        await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
        expect((await camera.getSonyCapabilities(query)).map(property => property.code)).toEqual(codes)
    })
    it('labels Auto and Manual choices of the exposure mode aliases', async () => {
        const camera = new SonyWifiCamera(bridgeForProperties(exposureModes).bridge)
        await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
        for (const alias of ['ApertureMode', 'ShutterMode', 'IsoMode'] as const) {
            expect((await camera.getSonyProperty(alias)).choices).toEqual([
                { value: '1', label: 'Auto' }, { value: '2', label: 'Manual' },
            ])
        }
    })
    it('resolves exact friendly and familiar names, validates choices, and confirms readback', async () => {
        const values: Record<string, string> = { 264: '0', 260: '100' }
        const { bridge, requests } = bridgeForProperties()
        const original = bridge.request
        bridge.request = async command => {
            if (command.cmd === 'properties')
                return { properties: [
                    { code: 264, type: 2, value: values[264], writable: true, allowedValues: ['0', '17'] },
                    { code: 260, type: 3, value: values[260], writable: true, allowedValues: ['100', '3200'] },
                ] }
            if (command.cmd === 'set') values[command.code!] = command.value!
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
        expect(await camera.setSonySetting('ISO', 3200)).toMatchObject({ before: { name: 'IsoSensitivity' }, after: { value: '3200' } })
        expect(requests.filter(command => command.cmd === 'set')).toHaveLength(2)
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
    await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
    await expect(camera.getRecentSonyContents()).resolves.toEqual([{id:123,files:[]}])
    expect(attempts).toBe(2)
    bridge.request=async()=>{throw new Error('Sony SDK command failed (SDK code 36102)')}
    await expect(camera.getRecentSonyContents()).rejects.toThrow('36102')
})

it.each([
 [{contents:[],truncated:true},'incomplete content index'],
 [{contents:[]},'rebuild the SDK bridge'],
])('refuses a complete-index reply %j without evidence of completeness',async(reply,error)=>{
 const {bridge,requests}=bridgeForProperties(),camera=new SonyWifiCamera(bridge)
 await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
 bridge.request=async command=>{requests.push(command);return reply}
 await expect(camera.getRecentSonyContents({all:true})).rejects.toThrow(error)
 expect(requests.at(-1)).toEqual({cmd:'recent_contents',scope:'all'})
 await expect(camera.getRecentSonyContents()).resolves.toEqual([])
})

it('marks only exhausted contents-processing errors for one stopped-transfer reconnect',async()=>{
 vi.useFakeTimers()
 try{
  const bridge:SonySdkBridge={request:async command=>{if(command.cmd==='recent_contents')throw new Error('Sony SDK command failed (SDK code 36101)');return {ok:true}},close:async()=>{}}
  const camera=new SonyWifiCamera(bridge);await camera.connectBluetoothDirect({ host: '192.0.2.98', mac: '0C:80:2F:A7:36:AD', model: 'ILME-FX2', bluetoothAddress: '0C:80:2F:A7:36:AE' })
  const pending=expect(camera.getRecentSonyContents({all:true})).rejects.toMatchObject({retryableTransfer:true,message:expect.stringContaining('original footage remains on the card')})
  await vi.advanceTimersByTimeAsync(15250);await pending
  bridge.request=async()=>{throw new Error('Sony SDK command failed (SDK code 36102)')}
  const error=await camera.getRecentSonyContents().catch(error=>error)
  expect(error.message).toContain('36102');expect(error.retryableTransfer).not.toBe(true)
 }finally{vi.useRealTimers()}
})
