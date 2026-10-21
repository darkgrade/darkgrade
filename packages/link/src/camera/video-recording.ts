import {readCameraStorages} from '@camera/storage'
import {openCanonRecordingMode} from '@vendors/canon/recording-mode'
import type {TakeMedia} from '@workflows/video-take'
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds))
/** Persistent USB movie recording, final-file discovery and bounded-memory transfer. */
export class UsbVideoRecording {
    private baseline=new Set<number>()
    private attempted=false
    private movieMode?:Awaited<ReturnType<typeof openCanonRecordingMode>>
    constructor(private readonly camera:any,private readonly vendor:'canon'|'nikon'){}
    private get operations(){return this.camera.getInstance().registry.operations}
    private async handles(){
        const storage=await this.camera.send(this.operations.GetStorageIDs,{})
        if(storage.code!==0x2001)throw new Error('Camera storage could not be read')
        const handles=new Set<number>()
        for(const id of storage.data||[]){
            if((Number(id)&0xffff)===0)continue
            const result=await this.camera.send(this.operations.GetObjectHandles,{StorageID:id})
            if(result.code!==0x2001)throw new Error('Camera files could not be listed: 0x'+result.code.toString(16))
            for(const handle of result.data||[])handles.add(Number(handle))
        }
        return handles
    }
    async prepare(){
        const storages=await readCameraStorages(this.camera)
        if(!storages.some(card=>card.writable&&card.freeBytes>0))throw new Error('Insert a writable memory card with free space before recording')
        if(this.vendor==='canon'){
            const states=await this.camera.getCanonPropertyStates()
            if(states.some((state:any)=>state.name==='CanonRecordingDestination'&&state.value==='CARD'))throw new Error('This camera is already recording')
        }
        this.baseline=await this.handles()
    }
    async start(){
        if(this.vendor==='canon')this.movieMode=await openCanonRecordingMode(this.camera)
        this.attempted=true
        await this.camera.startRecording()
        const states=this.vendor==='canon'?await this.camera.getCanonPropertyStates():[]
        const confirmed=states.some((state:any)=>state.name==='CanonRecordingDestination'&&state.value==='CARD')
        return {recordingConfirmed:confirmed,evidence:confirmed?'Camera reports card recording':'Movie-start command acknowledged; recording-state telemetry unavailable'}
    }
    async stop(){
        if(!this.attempted)return {stopped:true,media:[] as TakeMedia[]}
        await this.camera.stopRecording();this.attempted=false
        const deadline=Date.now()+15000
        let media:TakeMedia[]=[]
        let lastIndexError:string|undefined
        do{
            try{
                media=[]
                for(const handle of await this.handles()){
                    if(this.baseline.has(handle))continue
                    const result=await this.camera.send(this.operations.GetObjectInfo,{ObjectHandle:handle}),info=result.data
                    const bytes=Number(info?.objectCompressedSize)
                    if(result.code===0x2001&&Number.isSafeInteger(bytes)&&bytes>0&&/\.(mp4|mov|mts|m2ts|avi|crm)$/i.test(info?.filename||''))media.push({id:String(handle),filename:String(info.filename),bytes,verified:true})
                }
                if(media.length)break
            }catch(error){lastIndexError=error instanceof Error?error.message:String(error)}
            await sleep(300)
        }while(Date.now()<deadline)
        await this.movieMode?.restore();this.movieMode=undefined
        return {stopped:true,media,...(!media.length?{warning:'Recording stopped, but a new card movie is not yet available. Originals remain on the card.'+(lastIndexError?' '+lastIndexError:'')}:{})}
    }
    async transfer(file:TakeMedia,write:(bytes:Uint8Array)=>Promise<void>,progress:(bytes:number,total:number)=>void){
        const handle=Number(file.id),fresh=await this.camera.send(this.operations.GetObjectInfo,{ObjectHandle:handle})
        if(fresh.code!==0x2001||fresh.data?.filename!==file.filename||Number(fresh.data?.objectCompressedSize)!==file.bytes)throw new Error('Camera file changed; transfer refused')
        if(!Number.isSafeInteger(file.bytes)||file.bytes<=0)throw new Error('Invalid camera file size')
        const extended=this.vendor==='nikon'&&this.operations.GetPartialObjectEx
        if(!extended&&file.bytes>0xffffffff)throw new Error('This camera transfer path cannot safely address files over 4 GiB; copy this original from its card')
        let offset=0
        while(offset<file.bytes){
            const count=Math.min(2*1024*1024,file.bytes-offset)
            const response=await this.camera.send(extended||this.operations.GetPartialObject,extended?{ObjectHandle:handle,OffsetLower:offset>>>0,OffsetUpper:Math.floor(offset/0x100000000),MaxSizeLower:count,MaxSizeUpper:0}:{ObjectHandle:handle,Offset:offset,MaxBytes:count},undefined,count+12)
            if(response.code!==0x2001||!(response.data instanceof Uint8Array)||!response.data.length||response.data.length>count)throw new Error('Camera returned an incomplete video chunk')
            await write(response.data);offset+=response.data.length;progress(offset,file.bytes)
        }
    }
    async cleanup(){if(this.attempted)await this.stop();else await this.movieMode?.restore()}
}
