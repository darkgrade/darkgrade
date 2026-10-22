import { Logger } from '@core/logger'
import { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { DeviceBusy, OK } from '@ptp/definitions/response-definitions'
import { afterEach, describe, expect, it, vi } from 'vitest'

const metadata = () => ({
    majorVersion: 2, minorVersion: 1,
    wholeSize: { horizontal: 6048, vertical: 3400 },
    displayAreaSize: { horizontal: 6048, vertical: 3400 },
    displayCenterCoords: { horizontal: 3024, vertical: 1700 },
    liveViewImageImageSize: { horizontal: 640, vertical: 360 },
    afFrameSize: { horizontal: 815, vertical: 884 },
    afFrameCenterCoords: { horizontal: 3024, vertical: 848 },
    afDrivingEnabled: 1, focusDrivingStatus: 0, focusingJudgementResult: 0,
    reserved: new Uint8Array(7), afFrameData: new Uint8Array(760),
    autoCaptureSubjectDetection: new Uint8Array(52), reservedEnd: new Uint8Array(118),
    liveViewImage: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
})

function fixture() {
    const transport = { isLittleEndian: () => true, isConnected: () => true,
        connect: vi.fn(), disconnect: vi.fn(), send: vi.fn(), receive: vi.fn(),
        classRequestReset: vi.fn(), getType: () => 'USB', on: vi.fn() }
    const camera = new NikonCamera(transport as any, new Logger({ captureConsole: false, renderInTerminal: false }))
    let frame = metadata()
    let supported = [0x90c1, 0x9204, 0x9205, 0x9206, 0x9428, 0x90c8, 0x9201]
    const calls: { name: string; params: any }[] = []
    const responses = new Map<string, number>()
    const send = vi.spyOn(camera, 'send').mockImplementation(async (operation, params) => {
        calls.push({ name: operation.name, params })
        const code = responses.get(operation.name) ?? OK.code
        if (operation.name === 'GetDeviceInfo') return { code, data: { operationsSupportedRaw: supported } } as any
        if (operation.name === 'GetLiveViewImageEx') return { code, data: frame } as any
        return { code } as any
    })
    return { camera, calls, responses, send, transport, setFrame: (next: any) => { frame = next },
        setSupported: (next: number[]) => { supported = next } }
}

afterEach(() => { vi.useRealTimers() })

describe('Nikon capability-gated focus', () => {
    it('defines the advertised activation commands and exact parameters', () => {
        const { camera } = fixture()
        expect(['AfDrive', 'MfDrive', 'ChangeAfArea', 'AfDriveCancel'].map(name => (camera.registry.operations as any)[name].code))
            .toEqual([0x90c1, 0x9204, 0x9205, 0x9206])
    })

    it('preserves JPEG data and returns fresh metadata without duplicating JPEG bytes', async () => {
        const { camera, setFrame } = fixture()
        const first = await camera.captureLiveView({ includeInfo: false })
        expect(first.data).toEqual(metadata().liveViewImage)
        expect(first.nikonMetadata).toMatchObject({ majorVersion: 2, wholeSize: { horizontal: 6048, vertical: 3400 } })
        for (const field of ['liveViewImage', 'reserved', 'afFrameData', 'autoCaptureSubjectDetection', 'reservedEnd'])
            expect(first.nikonMetadata).not.toHaveProperty(field)
        setFrame({ ...metadata(), focusingJudgementResult: 2 })
        expect((await camera.captureLiveView()).nikonMetadata?.focusingJudgementResult).toBe(2)
    })

    it('refuses unadvertised operations before starting live view or driving focus', async () => {
        const { camera, calls, setSupported } = fixture()
        setSupported([])
        await expect(camera.autofocus()).rejects.toThrow('advertise AfDrive')
        await expect(camera.touchFocus(0.5, 0.5)).rejects.toThrow('advertise ChangeAfArea')
        await expect(camera.driveFocus('near')).rejects.toThrow('advertise MfDrive')
        expect(calls.map(call => call.name)).toEqual(['GetDeviceInfo', 'GetDeviceInfo', 'GetDeviceInfo'])
    })

    it('does not infer focus lock from accepted autofocus or a driving focus engine', async () => {
        const { camera, setFrame } = fixture()
        expect(await camera.autofocus()).toMatchObject({ commandSent: true, focusAcquired: false })
        setFrame({ ...metadata(), focusingJudgementResult: 2, focusDrivingStatus: 1 })
        expect((await camera.autofocus()).focusAcquired).toBe(false)
        setFrame({ ...metadata(), focusingJudgementResult: 2 })
        expect((await camera.autofocus()).focusAcquired).toBe(true)
    })

    it('reports Nikon OutOfFocus as an unsuccessful focus result even if metadata reports focused', async () => {
        const { camera, responses, setFrame } = fixture()
        await camera.captureLiveView()
        responses.set('DeviceReady', 0xa002)
        setFrame({ ...metadata(), focusingJudgementResult: 2 })
        expect((await camera.autofocus()).focusAcquired).toBe(false)
    })

    it('maps normalized coordinates using 6048×3400 AF dimensions rather than 640×360 JPEG dimensions', async () => {
        const { camera, calls } = fixture()
        const result = await camera.touchFocus(0.5, 0.25, { focus: false })
        expect(calls.find(call => call.name === 'ChangeAfArea')?.params).toEqual({ X: 3024, Y: 850 })
        expect(result).toMatchObject({ commandSent: true, positionVerified: true, normalized: { x: 0.5, y: 0.25 },
            x: 3024, y: 850, width: 6048, height: 3400, tolerance: { x: 407, y: 442 } })
        expect(calls.some(call => call.name === 'AfDrive')).toBe(false)
    })

    it('reports ignored point placement without claiming position verification', async () => {
        const { camera } = fixture()
        expect(await camera.touchFocus(0.5, 0.5, { focus: false })).toMatchObject({ commandSent: true, positionVerified: false })
    })

    it('supports coordinate boundaries and rejects invalid coordinates or missing dimensions before point writes', async () => {
        const { camera, calls, setFrame } = fixture()
        await camera.touchFocus(1, 1, { focus: false })
        expect(calls.find(call => call.name === 'ChangeAfArea')?.params).toEqual({ X: 6047, Y: 3399 })
        calls.length = 0
        await expect(camera.touchFocus(NaN, 0)).rejects.toThrow('normalized')
        await expect(camera.touchFocus(-0.1, 0)).rejects.toThrow('normalized')
        expect(calls).toEqual([])
        setFrame({ ...metadata(), wholeSize: { horizontal: 0, vertical: 0 } })
        await expect(camera.touchFocus(0.5, 0.5, { focus: false })).rejects.toThrow('dimensions')
        expect(calls.some(call => call.name === 'ChangeAfArea')).toBe(false)
    })

    it.each([['near', 1], ['far', 2]] as const)('drives %s by explicit lens steps and reads completion metadata', async (direction, code) => {
        const { camera, calls } = fixture()
        expect(await camera.driveFocus(direction, 12)).toMatchObject({ commandSent: true, completed: true })
        expect(calls.find(call => call.name === 'MfDrive')?.params).toEqual({ Direction: code, Steps: 12 })
        expect(calls.at(-1)?.name).toBe('GetLiveViewImageEx')
    })

    it('bounds focus inputs and propagates lens endpoint responses', async () => {
        const { camera, calls, responses } = fixture()
        await expect(camera.driveFocus('near', 0)).rejects.toThrow('lens steps')
        await expect(camera.driveFocus('far', 32768)).rejects.toThrow('lens steps')
        await expect(camera.autofocus(0)).rejects.toThrow('timeout')
        expect(calls).toEqual([])
        responses.set('MfDrive', 0xa00c)
        await expect(camera.driveFocus('near')).rejects.toThrow('0xa00c')
    })

    it('bounds autofocus completion and cancels only an advertised autofocus command', async () => {
        vi.useFakeTimers()
        const { camera, responses, calls } = fixture()
        await camera.captureLiveView()
        responses.set('DeviceReady', DeviceBusy.code)
        const assertion = expect(camera.autofocus(100)).rejects.toThrow('timed out')
        await vi.advanceTimersByTimeAsync(120)
        await assertion
        expect(calls.filter(call => call.name === 'AfDriveCancel')).toHaveLength(1)
    })

    it('bounds existing readiness polling and fails immediately on non-busy error responses', async () => {
        vi.useFakeTimers()
        const { camera, responses } = fixture()
        responses.set('DeviceReady', DeviceBusy.code)
        const assertion = expect(camera.captureLiveView()).rejects.toThrow('timed out')
        await vi.advanceTimersByTimeAsync(5100)
        await assertion
        responses.set('DeviceReady', 0xa004)
        await expect(camera.captureLiveView()).rejects.toThrow('0xa004')
    })

    it('reads only advertised extended vendor IDs with kind 13 and bounded uint32 array validation', async () => {
        const { camera, send, setSupported } = fixture()
        setSupported([0x9439])
        const bytes = new Uint8Array(12), view = new DataView(bytes.buffer)
        view.setUint32(0, 2, true); view.setUint32(4, 0xd061, true); view.setUint32(8, 0x10000001, true)
        const original = send.getMockImplementation()!
        send.mockImplementation(async (operation, ...parameters) => operation.name === 'GetVendorCodes'
            ? { code: OK.code, data: bytes } as any : original(operation, ...parameters) as any)
        expect(await camera.getVendorPropertyCodes()).toEqual([0xd061, 0x10000001])
        expect(send).toHaveBeenCalledWith(camera.registry.operations.GetVendorCodes, { Kind: 13 }, undefined, 16400)
        view.setUint32(0, 4097, true)
        await expect(camera.getVendorPropertyCodes()).rejects.toThrow('invalid array length')
        view.setUint32(0, 1, true)
        await expect(camera.getVendorPropertyCodes()).rejects.toThrow('invalid array length')
        setSupported([])
        await expect(camera.getVendorPropertyCodes()).rejects.toThrow('advertise GetVendorCodes')
    })

    it('does not send movie start while the camera reports a missing card', async () => {
        const { camera, calls } = fixture()
        vi.spyOn(camera, 'get').mockImplementation(async property => {
            if (property.name === 'LiveViewStatus') return 'OFF' as any
            if (property.name === 'LiveViewSelector') return 'VIDEO' as any
            return 'noCardInserted' as any
        })
        await expect(camera.startRecording()).rejects.toThrow('noCardInserted')
        expect(calls.some(call => call.name === 'StartMovieRecord')).toBe(false)
    })

    it('rejects failed start and stop movie responses instead of reporting completion', async () => {
        const { camera, responses } = fixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'OFF' : property.name === 'LiveViewSelector' ? 'VIDEO' : 'none') as any)
        responses.set('StartMovieRecord', 0xa004)
        await expect(camera.startRecording()).rejects.toThrow('StartMovieRecord failed')
        responses.set('EndMovieRecord', 0xa004)
        await expect(camera.stopRecording()).rejects.toThrow('EndMovieRecord failed')
    })

    it('bounds image-buffer readiness and never starts a movie when the buffer remains busy', async () => {
        vi.useFakeTimers()
        const { camera, calls } = fixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'OFF' : property.name === 'LiveViewSelector' ? 'VIDEO' : 'imagesInBuffer') as any)
        const assertion = expect(camera.startRecording()).rejects.toThrow('image buffer did not become ready')
        await vi.advanceTimersByTimeAsync(5100)
        await assertion
        expect(calls.some(call => call.name === 'StartMovieRecord')).toBe(false)
    })

    it.each([[0x2019, 'DeviceBusy'], [0xa004, 'InvalidStatus'], [0xa00c, 'MfDriveStepEnd'], [0xa00e, 'MfDriveStepInsufficiency']])(
        'names manual-focus response %i as %s and suggests AF-S', async (code, name) => {
            const { camera, responses } = fixture()
            responses.set('MfDrive', code as number)
            const operation = camera.driveFocus('near')
            await expect(operation).rejects.toThrow(name as string)
            await expect(operation).rejects.toThrow('AF-S')
        }
    )

    it('names manual-focus endpoint errors returned during completion polling', async () => {
        const { camera, responses } = fixture()
        await camera.captureLiveView()
        responses.set('DeviceReady', 0xa00c)
        await expect(camera.driveFocus('far')).rejects.toThrow('MfDriveStepEnd (0xa00c)')
    })

    it('cleans up owned movie setup modes and restores the photo selector after a prohibition', async () => {
        const { camera, calls } = fixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'OFF' : property.name === 'LiveViewSelector' ? 'PHOTO' : 'noCardInserted') as any)
        const set = vi.spyOn(camera, 'set').mockResolvedValue(undefined)
        await expect(camera.startRecording()).rejects.toThrow('noCardInserted')
        expect(calls.filter(call => ['ChangeCameraMode', 'ChangeApplicationMode', 'StartLiveView', 'EndLiveView'].includes(call.name)))
            .toEqual([
                { name: 'ChangeCameraMode', params: { Mode: 'REMOTE' } },
                { name: 'StartLiveView', params: {} },
                { name: 'ChangeApplicationMode', params: { Mode: 'ON' } },
                { name: 'EndLiveView', params: {} },
                { name: 'ChangeApplicationMode', params: { Mode: 'OFF' } },
                { name: 'ChangeCameraMode', params: { Mode: 'PC_CAMERA' } },
            ])
        expect(set.mock.calls.map(([, value]) => value)).toEqual(['VIDEO', 'PHOTO'])
    })

    it('restores application mode after its enable command succeeds but readiness fails', async () => {
        const { camera, calls, send } = fixture()
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'OFF' : property.name === 'LiveViewSelector' ? 'VIDEO' : 'none') as any)
        ;(camera as any).applicationMode = 'OFF'
        const original = send.getMockImplementation()!
        let failNextReady = false
        send.mockImplementation(async (operation, parameters, ...remaining) => {
            const response = await original(operation, parameters, ...remaining)
            if (operation.name === 'ChangeApplicationMode' && (parameters as any).Mode === 'ON') failNextReady = true
            else if (operation.name === 'DeviceReady' && failNextReady) {
                failNextReady = false
                return { code: 0xa004 } as any
            }
            return response as any
        })
        await expect(camera.startRecording()).rejects.toThrow('InvalidStatus')
        expect(calls.filter(call => call.name === 'ChangeApplicationMode').map(call => call.params.Mode)).toEqual(['ON', 'OFF'])
        expect(calls.some(call => call.name === 'EndLiveView')).toBe(true)
    })

    it('preserves live view and application mode that were already active before failed movie setup', async () => {
        const { camera, calls } = fixture()
        ;(camera as any).applicationMode = 'ON'
        ;(camera as any).cameraMode = 'REMOTE'
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'ON' : property.name === 'LiveViewSelector' ? 'VIDEO' : 'noCardInserted') as any)
        await expect(camera.startRecording()).rejects.toThrow('noCardInserted')
        expect(calls.some(call => ['EndLiveView', 'ChangeApplicationMode', 'ChangeCameraMode'].includes(call.name))).toBe(false)
    })

    it('continues owned cleanup after a restoration error and reports the original prohibition', async () => {
        const { camera, calls, responses } = fixture()
        responses.set('EndLiveView', 0xa004)
        vi.spyOn(camera, 'get').mockImplementation(async property =>
            (property.name === 'LiveViewStatus' ? 'OFF' : property.name === 'LiveViewSelector' ? 'VIDEO' : 'noCardInserted') as any)
        const operation = camera.startRecording()
        await expect(operation).rejects.toThrow('noCardInserted; Nikon recording setup cleanup failed')
        expect(calls.filter(call => call.name === 'ChangeApplicationMode').at(-1)?.params).toEqual({ Mode: 'OFF' })
    })

    it('routes the public Nikon focus API without changing generic autofocus return semantics', async () => {
        const { camera: instance, transport } = fixture()
        const camera = new Camera({ vendorId: 0x04b0, transport: transport as any,
            logger: { captureConsole: false, renderInTerminal: false } })
        const nikon = camera.getInstance() as NikonCamera
        const autofocus = vi.spyOn(nikon, 'autofocus').mockResolvedValue({ commandSent: true, focusAcquired: false, metadata: {} as any })
        await expect(camera.autofocus()).resolves.toBeUndefined()
        await expect(camera.nikonAutofocus()).resolves.toMatchObject({ focusAcquired: false })
        const point = vi.spyOn(nikon, 'touchFocus').mockResolvedValue({ positionVerified: false } as any)
        await camera.nikonTouchFocus(0.5, 0.25, { focus: false })
        expect(point).toHaveBeenCalledWith(0.5, 0.25, { focus: false })
        const drive = vi.spyOn(nikon, 'driveFocus').mockResolvedValue({ completed: true } as any)
        await camera.nikonDriveFocus('far', 3)
        expect(drive).toHaveBeenCalledWith('far', 3)
        expect(autofocus).toHaveBeenCalledTimes(2)
        expect(instance).toBeInstanceOf(NikonCamera)
    })
})

describe('Nikon recording transition reliability',()=>{
 it('accepts denied application mode only when fresh telemetry confirms the requested state',async()=>{
  const {camera,responses}=fixture();responses.set('ChangeApplicationMode',0x200f)
  vi.spyOn(camera,'get').mockResolvedValue('none' as never)
  await expect((camera as any).changeApplicationMode('ON')).resolves.toBeUndefined()
  vi.mocked(camera.get).mockResolvedValue('notInApplicationMode' as never)
  await expect((camera as any).changeApplicationMode('OFF')).resolves.toBeUndefined()
 })
 it('retries a denied transition within a bound and refuses unconfirmed application mode',async()=>{
  const {camera,responses,calls}=fixture();responses.set('ChangeApplicationMode',0x200f)
  vi.spyOn(camera,'get').mockResolvedValue('notInApplicationMode' as never)
  await expect((camera as any).changeApplicationMode('ON')).rejects.toThrow('AccessDenied')
  expect(calls.filter(call=>call.name==='ChangeApplicationMode')).toHaveLength(3)
 })
 it('does not swallow rejected Nikon property writes',async()=>{
  const {camera,responses}=fixture();responses.set('SetDevicePropValueEx',0x200f)
  await expect(camera.set(camera.registry.properties.LiveViewSelector,'VIDEO')).rejects.toThrow('LiveViewSelector write failed: AccessDenied')
 })
 it('closes the transport even when stopping live view fails',async()=>{
  const {camera,responses,transport}=fixture();await camera.captureLiveView();responses.set('EndLiveView',0xa004)
  await expect(camera.disconnect()).rejects.toThrow('EndLiveView')
  expect(transport.disconnect).toHaveBeenCalled()
 })
})

it('waits for Nikon recording-state telemetry to clear before leaving its recording modes',async()=>{
 const {camera,calls}=fixture();let samples=0
 ;(camera as any).liveViewStatus='ON';(camera as any).applicationMode='ON'
 vi.spyOn(camera,'get').mockImplementation(async()=>{
  samples++
  if(samples<=2){expect(calls.some(call=>call.name==='EndLiveView')).toBe(false);expect(calls.some(call=>call.name==='ChangeApplicationMode')).toBe(false);return 'alreadyRecording' as never}
  return 'none' as never
 })
 await camera.stopRecording();expect(samples).toBeGreaterThan(2);expect(calls.some(call=>call.name==='EndLiveView')).toBe(true)
})

it('renews an idle Nikon PTP session before movie mode without reconnecting USB',async()=>{
 const {camera,calls,transport}=fixture();camera.sessionId=12
 vi.spyOn(camera,'get').mockImplementation(async property=>(property.name==='LiveViewStatus'?'OFF':property.name==='LiveViewSelector'?'VIDEO':'notInApplicationMode') as any)
 await expect(camera.startRecording()).rejects.toThrow('Movie recording is prohibited')
 expect(calls.filter(call=>['CloseSession','OpenSession'].includes(call.name))).toEqual([{name:'CloseSession',params:{}},{name:'OpenSession',params:{SessionID:13}}])
 expect(calls.findIndex(call=>call.name==='OpenSession')).toBeLessThan(calls.findIndex(call=>call.name==='ChangeApplicationMode'))
 expect(transport.disconnect).not.toHaveBeenCalled()
 expect(camera.sessionId).toBe(13)
})
it('never renews a Nikon session while its card movie is recording',async()=>{
 const {camera,calls}=fixture();camera.sessionId=12
 vi.spyOn(camera,'get').mockResolvedValue('alreadyRecording' as never)
 await expect(camera.startRecording()).rejects.toThrow('already recording')
 expect(calls).toHaveLength(0);expect(camera.sessionId).toBe(12)
})
it('does not continue movie setup when the fresh Nikon PTP session is rejected',async()=>{
 const {camera,calls,responses}=fixture();camera.sessionId=12;responses.set('OpenSession',0x200f)
 vi.spyOn(camera,'get').mockResolvedValue('notInApplicationMode' as never)
 await expect(camera.startRecording()).rejects.toThrow('movie session open failed: AccessDenied')
 expect(calls.some(call=>call.name==='StartMovieRecord'||call.name==='ChangeApplicationMode')).toBe(false)
 expect(camera.sessionId).toBeNull()
})
