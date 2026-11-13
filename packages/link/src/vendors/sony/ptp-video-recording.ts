import {readCameraObjectHandles} from '@camera/storage'
import type {TakeMedia} from '@workflows/video-take'

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
/** Native Sony PTP only: observed movie state, card identity and bounded-memory transfer. */
export class SonyPtpVideoRecording {
    private baseline=new Set<number>()
    private attempted=false
    constructor(private readonly camera:any){}
    private get operations(){return this.camera.getInstance().registry.operations}
    async state(){
        const state=(await this.camera.getSonyPropertyStates()).find((p:any)=>p.code===0xd21d)
        const value=Number(state?.rawValue)
        if(!Number.isInteger(value)||value<0||value>3)throw new Error('Sony did not report a valid native movie state')
        return value
    }
    async prepare(){
        if(await this.state()!==0)throw new Error('Sony is already recording or finalizing a movie')
        this.baseline=await readCameraObjectHandles(this.camera)
    }
    async start(){
        if(await this.state()!==0)throw new Error('Sony is already recording or finalizing a movie')
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
    private async info(handle:number){
        const response=await this.camera.send(this.operations.GetObjectInfo,{ObjectHandle:handle})
        if(response.code!==0x2001||!response.data)throw new Error('Sony original information unavailable')
        const info=response.data,bytes=Number(info.objectCompressedSize)
        if(!Number.isSafeInteger(bytes)||bytes<=0||bytes===0xffffffff)throw new Error('Sony original size is unavailable or exceeds the object-info size range')
        return {id:String(handle),filename:String(info.filename),bytes,verified:true} satisfies TakeMedia
    }
    async stop(){
        if(!this.attempted)return {stopped:true,media:[] as TakeMedia[]}
        await this.confirmStopped();this.attempted=false
        const deadline=Date.now()+15000
        let lastError:unknown
        do{
            try{
                const media:TakeMedia[]=[]
                for(const handle of await readCameraObjectHandles(this.camera)){
                    if(this.baseline.has(handle))continue
                    const file=await this.info(handle)
                    if(/\.(mp4|mov|mxf|mts|m2ts)$/i.test(file.filename))media.push(file)
                }
                if(media.length)return {stopped:true,media}
            }catch(error){lastError=error}
            await sleep(300)
        }while(Date.now()<deadline)
        return {stopped:true,media:[] as TakeMedia[],warning:'Sony stopped; its new original is not yet available. '+(lastError instanceof Error?lastError.message:'Original remains on the card.')}
    }
    async transfer(file:TakeMedia,write:(bytes:Uint8Array)=>Promise<void>,progress:(bytes:number,total:number)=>void){
        if(await this.state()!==0)throw new Error('Stop Sony recording before transferring footage')
        await this.camera.getInstance().prepareStorageRead()
        const handle=Number(file.id)
        if(!Number.isInteger(handle)||handle<=0||handle>0xffffffff)throw new Error('Invalid Sony original handle')
        const fresh=await this.info(handle)
        if(fresh.filename!==file.filename||fresh.bytes!==file.bytes)throw new Error('Sony original identity changed; transfer refused')
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
