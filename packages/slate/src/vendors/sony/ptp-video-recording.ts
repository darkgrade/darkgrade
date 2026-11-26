import { protocolAccess } from '@camera/protocol-session'
import {readCameraObjectHandles} from '@vendors/generic/storage'
import {stopCameraRecording} from '@camera/video-recording'
import type {TakeMedia} from '@workflows/video-take'

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
/** Native state: 0 idle, 1 recording, 2 recording failed, 3 interval-recording waiting. */
export async function readSonyPtpRecordingState(camera: {getSonyPropertyStates(): Promise<{code:number;rawValue:unknown}[]>}) {
    const raw = (await camera.getSonyPropertyStates()).find(state => state.code === 0xd21d)?.rawValue
    const value = typeof raw === 'number' || typeof raw === 'bigint' ? Number(raw) : NaN
    return Number.isInteger(value) && value >= 0 && value <= 3 ? value : undefined
}
/** Native Sony PTP only: observed movie state, card identity and bounded-memory transfer. */
export class SonyPtpVideoRecording {
    private baseline=new Set<number>()
    private attempted=false
    private prepared=false
    private stoppedResult?:{stopped:boolean;media:TakeMedia[];warning?:string}
    constructor(private readonly camera:any){}
    private get operations(){return protocolAccess(this.camera).driver.registry.operations}
    async state(){
        const value=await readSonyPtpRecordingState(protocolAccess(this.camera))
        if(value === undefined)throw new Error('Sony did not report a valid native movie state')
        return value
    }
    async prepare(){
        if(this.attempted)throw new Error('Stop the current Sony take before preparing another')
        this.prepared=false
        this.stoppedResult=undefined
        if(await this.state()!==0)throw new Error('Sony is already recording or finalizing a movie')
        // Camera.startRecording selects the movie mode; its stopRecording restores it after idle.
        this.baseline=await readCameraObjectHandles(this.camera)
        this.prepared=true
    }
    async start(){
        if(!this.prepared||this.attempted)throw new Error('Prepare Sony recording before starting a new take')
        if(await this.state()!==0)throw new Error('Sony is already recording or finalizing a movie')
        this.prepared=false
        this.attempted=true
        await this.camera.startRecording()
        const deadline=Date.now()+5000
        do{
            if(await this.state()===1)return {recordingConfirmed:true,evidence:'Native Sony PTP movie state reports recording'}
            await sleep(100)
        }while(Date.now()<deadline)
        throw new Error('Sony did not confirm native movie recording started')
    }
    private async confirmStopped(){
        await stopCameraRecording(this.camera)
        const deadline=Date.now()+15000
        do{if(await this.state()===0)return;await sleep(200)}while(Date.now()<deadline)
        throw new Error('Sony did not confirm recording stopped; preserve camera power')
    }
    getRecoveryState(){return {version:1,kind:'sony-ptp',handles:[...this.baseline]}}
    async stopInterrupted(recovery?:unknown){
        const saved=recovery as {version?:number;kind?:string;handles?:unknown[]}|undefined
        if(saved?.version===1&&saved.kind==='sony-ptp'&&Array.isArray(saved.handles)&&saved.handles.length<=100000&&saved.handles.every(h=>Number.isInteger(h)&&Number(h)>0&&Number(h)<=0xffffffff)){
            this.baseline=new Set(saved.handles as number[]);this.attempted=true;return this.stop()
        }
        await this.confirmStopped()
        return {stopped:true,media:[] as TakeMedia[],warning:'Recording stopped; original identity was not retained. Copy unindexed footage from the card.'}
    }
    private async originalSize(handle:number,reported:number,format:number){
        if(reported!==0xffffffff)return reported
        // libgphoto2 ptp.h ObjectSize (0xdc04) and ptp.c ptp_object_want at
        // 02d92fea8a269eb94330a4eade204ba799433606: MTP object properties can
        // override ObjectInfo with a UINT64 size. Bind to this exact handle,
        // never infer identity from a matching filename in a content list.
        const inventory=await protocolAccess(this.camera).send(this.operations.GetDeviceInfo,{})
        // DeviceInfo carries the numeric codes in operationsSupportedRaw; the decoded list holds names.
        const supported=inventory.data?.operationsSupportedRaw
        const has=(code:number)=>Array.isArray(supported)&&supported.includes(code)
        if(inventory.code!==0x2001||!((has(0x9802)&&has(0x9803))||has(0x9805)))
            throw new Error('Sony did not advertise a 64-bit original-size query; copy this original from its card')
        let size:number|undefined
        if(has(0x9802)&&has(0x9803)){
            const descriptor=await protocolAccess(this.camera).send(this.operations.MtpGetObjectPropDesc,{ObjectPropertyCode:0xdc04,ObjectFormatCode:Number.isInteger(format)&&format>=0&&format<=0xffff?format:0})
            const data=descriptor.data
            if(descriptor.code===0x2001){
                if(!(data instanceof Uint8Array)||data.length<18)throw new Error('Sony original-size descriptor is unavailable')
                const view=new DataView(data.buffer,data.byteOffset,data.byteLength)
                if(view.getUint16(0,true)!==0xdc04||view.getUint16(2,true)!==8)
                    throw new Error('Sony did not describe original size as UINT64')
                const result=await protocolAccess(this.camera).send(this.operations.MtpGetObjectPropValue,{ObjectHandle:handle,ObjectPropertyCode:0xdc04})
                if(result.code!==0x2001||!(result.data instanceof Uint8Array)||result.data.length!==8)
                    throw new Error('Sony did not return a complete 64-bit original size')
                size=Number(new DataView(result.data.buffer,result.data.byteOffset,8).getBigUint64(0,true))
            // 0x2005: the FX2 (firmware 1.01, bench take c1cc9e71, 2026-11-14) advertises the
            // descriptor operation and then answers OperationNotSupported. Any other refusal is an error.
            }else if(descriptor.code!==0x2005)throw new Error('Sony original-size descriptor is unavailable')
        }
        if(size===undefined&&has(0x9805)){
            // MTP GetObjectPropList for one handle and one property returns the value with its
            // data type: count, then handle, property code, data type, value. The same FX2 answered
            // this with UINT64 (type 8). Require the exact handle, property and type.
            const list=await protocolAccess(this.camera).send(this.operations.MtpGetObjectPropList,{ObjectHandle:handle,ObjectFormatCode:0,ObjectPropertyCode:0xdc04,GroupCode:0,Depth:0})
            const data=list.data
            if(list.code!==0x2001||!(data instanceof Uint8Array)||data.length!==20)
                throw new Error('Sony did not return a complete 64-bit original size')
            const view=new DataView(data.buffer,data.byteOffset,20)
            if(view.getUint32(0,true)!==1||view.getUint32(4,true)!==handle||view.getUint16(8,true)!==0xdc04||view.getUint16(10,true)!==8)
                throw new Error('Sony did not describe original size as UINT64')
            size=Number(view.getBigUint64(12,true))
        }
        if(size===undefined)throw new Error('Sony original-size descriptor is unavailable')
        if(!Number.isSafeInteger(size)||size<0xffffffff)throw new Error('Sony returned an invalid 64-bit original size')
        return size
    }
    private async info(handle:number):Promise<TakeMedia|undefined>{
        const response=await protocolAccess(this.camera).send(this.operations.GetObjectInfo,{ObjectHandle:handle})
        if(response.code!==0x2001||!response.data)throw new Error('Sony original information unavailable')
        const info=response.data
        // Card indexing may create a directory or sidecar before the new movie.
        // Inspect its kind before validating a movie size: folders legitimately have zero bytes.
        if(info.associationType>0||info.objectFormat===0x3001||!/\.(mp4|mov|mxf|mts|m2ts)$/i.test(info.filename||''))return undefined
        const bytes=await this.originalSize(handle,Number(info.objectCompressedSize),Number(info.objectFormat))
        if(!Number.isSafeInteger(bytes)||bytes<=0)throw new Error('Sony original size is unavailable')
        return {id:String(handle),filename:String(info.filename),bytes,verified:true}
    }
    async stop(){
        if(!this.attempted){
            this.prepared=false
            return this.stoppedResult??{stopped:true,media:[] as TakeMedia[]}
        }
        await this.confirmStopped();this.attempted=false
        const deadline=Date.now()+15000
        let lastError:unknown
        do{
            try{
                const media:TakeMedia[]=[]
                for(const handle of await readCameraObjectHandles(this.camera)){
                    if(this.baseline.has(handle))continue
                    const file=await this.info(handle)
                    if(file)media.push(file)
                }
                if(media.length)return this.stoppedResult={stopped:true,media}
            }catch(error){lastError=error}
            await sleep(300)
        }while(Date.now()<deadline)
        return this.stoppedResult={stopped:true,media:[] as TakeMedia[],warning:'Sony stopped; its new original is not yet available. '+(lastError instanceof Error?lastError.message:'Original remains on the card.')}
    }
    async transfer(file:TakeMedia,write:(bytes:Uint8Array)=>Promise<void>,progress:(bytes:number,total:number)=>void){
        if(await this.state()!==0)throw new Error('Stop Sony recording before transferring footage')
        const handle=Number(file.id)
        if(!Number.isInteger(handle)||handle<=0||handle>0xffffffff)throw new Error('Invalid Sony original handle')
        // Sony's object index is session-local. Querying a saved handle immediately
        // after reconnect left the a6700 unresponsive at GetObjectInfo. Enumerate
        // the current index before dereferencing any saved original identity.
        const handles=await readCameraObjectHandles(this.camera)
        if(!handles.has(handle))throw new Error('Sony original handle is no longer in the current card index; transfer refused')
        const fresh=await this.info(handle)
        if(!fresh||fresh.filename!==file.filename||fresh.bytes!==file.bytes)throw new Error('Sony original identity changed; transfer refused')
        let offset=0
        while(offset<file.bytes){
            const count=Math.min(2*1024*1024,file.bytes-offset)
            const response=await protocolAccess(this.camera).send(this.operations.SDIO_GetPartialLargeObject,{ObjectHandle:handle,OffsetLower:offset>>>0,OffsetUpper:Math.floor(offset/0x100000000),MaxBytes:count},undefined,count+12)
            if(response.code!==0x2001||!(response.data instanceof Uint8Array)||!response.data.length||response.data.length>count)throw new Error('Sony returned an incomplete original chunk')
            await write(response.data);offset+=response.data.length;progress(offset,file.bytes)
        }
    }
    async cleanup(){
        if(this.attempted)await this.stop()
        else this.prepared=false
    }
}
