import {describe,it,expect,vi,afterEach} from 'vitest'
import {TransportType} from '@transport/interfaces/transport-types'
import {nikonCamera} from '@tests/fixtures/nikon'
import {PTPResponseError} from '@core/ptp-errors'

function setup() {
    const camera=nikonCamera({getType:()=>TransportType.USB}),transport=camera.transport
    const warnings=[1,1,0],operations:number[]=[],movie:string[]=[]
    let releaseCode=0x2001
    const vendorProperties=[0xd102]
    let vendorData:Uint8Array|undefined
    let vendorResponse=0x2001
    const information={operationsSupportedRaw:[0x9207],devicePropertiesSupported:[0xd102]}
    camera.get=vi.fn(async property=>property.code===0xd102?warnings.shift():movie) as any
    camera.send=vi.fn(async operation=>{
        operations.push(operation.code)
        if(operation.code===0x9439){
            const data=new Uint8Array(4+vendorProperties.length*4),view=new DataView(data.buffer)
            view.setUint32(0,vendorProperties.length,true)
            vendorProperties.forEach((code,index)=>view.setUint32(4+index*4,code,true))
            return {code:vendorResponse,data:vendorData??data}
        }
        return {code:operation.code===0x9207?releaseCode:0x2001,...(operation.code===0x1001?{data:information}:{})}
    }) as any
    return {camera,transport,warnings,movie,operations,information,vendorProperties,
        setReleaseCode:(value:number)=>releaseCode=value,
        setVendorData:(value:Uint8Array)=>vendorData=value,
        setVendorResponse:(value:number)=>vendorResponse=value}
}

describe('Nikon documented sequence-error recovery',()=>{
    it('clears only an observed sequence error with one no-AF release and verifies the result',async()=>{
        const {camera,operations}=setup()
        expect(await camera.recoverSequenceError()).toBe(true)
        expect(operations).toEqual([0x1001,0x9207,0x90c8])
        expect(camera.send).toHaveBeenCalledWith(camera.registry.operations.InitiateCaptureRecInMedia,{AfMode:0xffffffff,Target:0})
    })
    it('uses the advertised vendor property inventory when Z5 II omits WarningStatus from DeviceInfo',async()=>{
        const {camera,information,operations}=setup()
        information.devicePropertiesSupported=[]
        information.operationsSupportedRaw.push(0x9439)
        expect(await camera.recoverSequenceError()).toBe(true)
        expect(camera.send).toHaveBeenCalledWith(camera.registry.operations.GetVendorCodes,{Kind:13},undefined,16400)
        expect(operations.filter(code=>code===0x9207)).toHaveLength(1)
    })
    it('does not release when neither property inventory advertises WarningStatus',async()=>{
        for(const code of [0xd101,0x1d102]){
            const {camera,information,vendorProperties,operations}=setup()
            information.devicePropertiesSupported=[]
            information.operationsSupportedRaw.push(0x9439)
            vendorProperties.splice(0,1,code)
            expect(await camera.recoverSequenceError()).toBe(false)
            expect(operations).not.toContain(0x9207)
        }
    })
    it.each([
        {inventory:'refused',response:0x2005,data:undefined,error:'vendor property enumeration failed'},
        {inventory:'truncated',response:0x2001,data:new Uint8Array(3),error:'vendor property enumeration'},
        {inventory:'short',response:0x2001,data:new Uint8Array([1,0,0,0]),error:'vendor property enumeration'},
        {inventory:'oversized',response:0x2001,data:new Uint8Array([1,16,0,0]),error:'vendor property enumeration'},
    ])('does not release after a $inventory vendor inventory',async({response,data,error})=>{
        const {camera,information,operations,setVendorData,setVendorResponse}=setup()
        information.devicePropertiesSupported=[]
        information.operationsSupportedRaw.push(0x9439)
        setVendorResponse(response)
        if(data)setVendorData(data)
        await expect(camera.recoverSequenceError()).rejects.toThrow(error)
        expect(operations).not.toContain(0x9207)
    })
    for(const warning of [0,2,3,256,undefined])it('does not release for warning '+warning,async()=>{
        const {camera,warnings,operations}=setup();warnings.splice(0,3,warning as number)
        expect(await camera.recoverSequenceError()).toBe(false)
        expect(operations).toEqual([0x1001])
    })
    it('requires USB, advertised capabilities and fresh unchanged warning state',async()=>{
        for(const condition of ['ip','operation','property','cleared','new-fault']){
            const {camera,transport,information,warnings,operations}=setup()
            if(condition==='ip')transport.getType=()=>TransportType.IP
            if(condition==='operation')information.operationsSupportedRaw=[]
            if(condition==='property')information.devicePropertiesSupported=[]
            if(condition==='cleared')warnings[1]=0
            if(condition==='new-fault')warnings[1]=3
            expect(await camera.recoverSequenceError()).toBe(false)
            expect(operations).not.toContain(0x9207)
        }
    })
    for(const flag of ['alreadyRecording','imagesInBuffer'])it('preserves '+flag,async()=>{
        const {camera,movie,operations}=setup();movie.push(flag)
        expect(await camera.recoverSequenceError()).toBe(false)
        expect(operations).not.toContain(0x9207)
    })
    it('does not retry a refused shutter release or claim success while a warning remains',async()=>{
        const refused=setup();refused.setReleaseCode(0x2019)
        await expect(refused.camera.recoverSequenceError()).rejects.toThrow()
        expect(refused.operations.filter(code=>code===0x9207)).toHaveLength(1)
        const stuck=setup();stuck.warnings[2]=1
        await expect(stuck.camera.recoverSequenceError()).rejects.toThrow('did not clear')
        expect(stuck.operations.filter(code=>code===0x9207)).toHaveLength(1)
    })
    // darkgrade01 Z5 II, 2026-11-25: StartLiveView and the 0x9207 release both answered HardwareError with
    // WarningStatus 1 about 50 s after a cold power-on; the same photo worked 2.5 minutes later.
    function warmingUp(refusals:number){
        const {camera,operations,setReleaseCode}=setup();setReleaseCode(0xa001)
        camera.get=vi.fn(async property=>property.code===0xd102?1:property.name==='LiveViewStatus'?'OFF':[]) as any
        const send=camera.send as any,inner=send.getMockImplementation()
        let starts=0
        send.mockImplementation(async(operation:any,...rest:any[])=>operation.code===0x9201
            ?(operations.push(0x9201),{code:++starts<=refusals?0xa001:0x2001}):inner(operation,...rest))
        let now=0;const waits:number[]=[]
        vi.spyOn(Date,'now').mockImplementation(()=>now)
        vi.spyOn(camera as any,'waitMs').mockImplementation(async(ms:any)=>{waits.push(ms);now+=ms})
        const captures=()=>operations.filter(code=>[0x100e,0x90c0,0x9207,0x9203,0x920a].includes(code))
        return {camera,operations,waits,captures,elapsed:()=>now}
    }
    afterEach(()=>vi.restoreAllMocks())
    it('waits for a body still warming up, sending only StartLiveView again, never the release',async()=>{
        const {camera,operations,waits,captures}=warmingUp(5)
        await (camera as any).enableLiveView()
        expect((camera as any).liveViewStatus).toBe('ON')
        // The one clearing release, refused by the camera (nothing taken), and no other capture command.
        expect(captures()).toEqual([0x9207])
        expect(operations.filter(code=>code===0x9201)).toHaveLength(6)
        expect(waits.filter(ms=>ms>=1000)).toEqual([1000,2000,4000,8000,8000])
    })
    it('still says the camera is not ready yet once the warm-up budget has passed',async()=>{
        const {camera,operations,captures,elapsed}=warmingUp(Infinity)
        const refused=await (camera as any).enableLiveView().catch((error:unknown)=>error)
        expect(refused).toBeInstanceOf(PTPResponseError)
        expect(refused.code).toBe(0xa001)
        expect(refused.message).toMatch(/^The camera is not ready yet/)
        expect(captures()).toEqual([0x9207])
        expect(elapsed()).toBe(90_000)
        const starts=operations.filter(code=>code===0x9201).length
        expect(starts).toBeGreaterThan(5);expect(starts).toBeLessThan(20)
        expect((camera as any).liveViewStatus).not.toBe('ON')
    })
    it('retries live-view startup once after verified recovery, without an unbounded release loop',async()=>{
        const {camera}=setup();let starts=0
        camera.get=vi.fn(async()=> 'OFF') as any
        camera.recoverSequenceError=vi.fn(async()=>true)
        camera.send=vi.fn(async operation=>({code:operation.code===0x9201&&++starts===1?0xa001:0x2001})) as any
        await (camera as any).enableLiveView()
        expect(starts).toBe(2);expect(camera.recoverSequenceError).toHaveBeenCalledTimes(1)
        ;(camera as any).liveViewStatus='OFF'
        camera.send=vi.fn(async()=>({code:0xa001})) as any
        await expect((camera as any).enableLiveView()).rejects.toThrow()
        expect(camera.send).toHaveBeenCalledTimes(2)
    })
})
