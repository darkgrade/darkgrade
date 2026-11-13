import {describe,it,expect,vi} from 'vitest'
import {NikonCamera} from '@camera/nikon-camera'
import {Logger} from '@core/logger'
import {TransportType} from '@transport/interfaces/transport-types'
import type {TransportInterface} from '@transport/interfaces/transport.interface'

function setup() {
    const transport={isLittleEndian:()=>true,on:()=>{},getType:()=>TransportType.USB} as unknown as TransportInterface
    const camera=new NikonCamera(transport,new Logger({expanded:false,captureConsole:false,renderInTerminal:false}))
    const warnings=[1,1,0],operations:number[]=[],movie:string[]=[]
    let releaseCode=0x2001
    const information={operationsSupportedRaw:[0x9207],devicePropertiesSupportedRaw:[0xd102]}
    camera.get=vi.fn(async property=>property.code===0xd102?warnings.shift():movie) as any
    camera.send=vi.fn(async operation=>{
        operations.push(operation.code)
        return {code:operation.code===0x9207?releaseCode:0x2001,...(operation.code===0x1001?{data:information}:{})}
    }) as any
    return {camera,transport,warnings,movie,operations,information,setReleaseCode:(value:number)=>releaseCode=value}
}

describe('Nikon documented sequence-error recovery',()=>{
    it('clears only an observed sequence error with one no-AF release and verifies the result',async()=>{
        const {camera,operations}=setup()
        expect(await camera.recoverSequenceError()).toBe(true)
        expect(operations).toEqual([0x1001,0x9207,0x90c8])
        expect(camera.send).toHaveBeenCalledWith(camera.registry.operations.InitiateCaptureRecInMedia,{AfMode:0xffffffff,Target:0})
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
            if(condition==='property')information.devicePropertiesSupportedRaw=[]
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
        const refused=setup();refused.setReleaseCode(0xa001)
        await expect(refused.camera.recoverSequenceError()).rejects.toThrow()
        expect(refused.operations.filter(code=>code===0x9207)).toHaveLength(1)
        const stuck=setup();stuck.warnings[2]=1
        await expect(stuck.camera.recoverSequenceError()).rejects.toThrow('did not clear')
        expect(stuck.operations.filter(code=>code===0x9207)).toHaveLength(1)
    })
    it('retries live-view startup once after verified recovery, without an unbounded release loop',async()=>{
        const {camera}=setup();let starts=0
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
