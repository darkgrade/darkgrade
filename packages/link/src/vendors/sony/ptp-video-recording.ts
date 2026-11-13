import {readCameraObjectHandles} from '@camera/storage'
import type {TakeMedia} from '@workflows/video-take'

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
/** Native Sony PTP only: observed movie state, card identity and bounded-memory transfer. */
export class SonyPtpVideoRecording {
    private baseline=new Set<number>()
    private attempted=false
    private prepared=false
    private stoppedResult?:{stopped:boolean;media:TakeMedia[];warning?:string}
    constructor(private readonly camera:any){}
    private get operations(){return this.camera.getInstance().registry.operations}
    async state(){
        const state=(await this.camera.getSonyPropertyStates()).find((p:any)=>p.code===0xd21d)
        const raw=state?.rawValue
        const value=typeof raw==='number'||typeof raw==='bigint'?Number(raw):NaN
        if(!Number.isInteger(value)||value<0||value>3)throw new Error('Sony did not report a valid native movie state')
        return value
    }
    async prepare(){
        if(this.attempted)throw new Error('Stop the current Sony take before preparing another')
        this.prepared=false
        this.stoppedResult=undefined
        if(await this.state()!==0)throw new Error('Sony is already recording or finalizing a movie')
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
        await this.camera.stopRecording()
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
        const inventory=await this.camera.send(this.operations.GetDeviceInfo,{})
        const supported=inventory.data?.operationsSupported
        if(inventory.code!==0x2001||!Array.isArray(supported)||![0x9802,0x9803].every(code=>supported.includes(code)))
            throw new Error('Sony did not advertise a 64-bit original-size query; copy this original from its card')
        const descriptor=await this.camera.send(this.operations.MtpGetObjectPropDesc,{ObjectPropertyCode:0xdc04,ObjectFormatCode:Number.isInteger(format)&&format>=0&&format<=0xffff?format:0})
        const data=descriptor.data
        if(descriptor.code!==0x2001||!(data instanceof Uint8Array)||data.length<18)
            throw new Error('Sony original-size descriptor is unavailable')
        const view=new DataView(data.buffer,data.byteOffset,data.byteLength)
        if(view.getUint16(0,true)!==0xdc04||view.getUint16(2,true)!==8)
            throw new Error('Sony did not describe original size as UINT64')
        const result=await this.camera.send(this.operations.MtpGetObjectPropValue,{ObjectHandle:handle,ObjectPropertyCode:0xdc04})
        if(result.code!==0x2001||!(result.data instanceof Uint8Array)||result.data.length!==8)
            throw new Error('Sony did not return a complete 64-bit original size')
        const size=Number(new DataView(result.data.buffer,result.data.byteOffset,8).getBigUint64(0,true))
        if(!Number.isSafeInteger(size)||size<0xffffffff)throw new Error('Sony returned an invalid 64-bit original size')
        return size
    }
    private async info(handle:number):Promise<TakeMedia|undefined>{
        const response=await this.camera.send(this.operations.GetObjectInfo,{ObjectHandle:handle})
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
        if(!this.attempted)return this.stoppedResult??{stopped:true,media:[] as TakeMedia[]}
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
            const response=await this.camera.send(this.operations.SDIO_GetPartialLargeObject,{ObjectHandle:handle,OffsetLower:offset>>>0,OffsetUpper:Math.floor(offset/0x100000000),MaxBytes:count},undefined,count+12)
            if(response.code!==0x2001||!(response.data instanceof Uint8Array)||!response.data.length||response.data.length>count)throw new Error('Sony returned an incomplete original chunk')
            await write(response.data);offset+=response.data.length;progress(offset,file.bytes)
        }
    }
    async cleanup(){if(this.attempted)await this.stop()}
}
