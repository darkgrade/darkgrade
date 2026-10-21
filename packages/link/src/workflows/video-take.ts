export interface TakeMedia {id:string;filename:string;bytes:number;downloadUrl?:string;verified:boolean}
export interface TakeCamera {
    prepare():Promise<void>
    start():Promise<{recordingConfirmed:boolean;evidence:string}>
    stop():Promise<{stopped:boolean;media:TakeMedia[];warning?:string}>
    collect(media:TakeMedia[],progress:(bytes:number,total:number)=>void):Promise<TakeMedia[]>
    close():Promise<void>
}
export interface TakeCameraState {camera:string;state:'preparing'|'ready'|'recording'|'stopping'|'stopped'|'collected'|'error'|'uncertain';recordingConfirmed?:boolean;startedAt?:string;stoppedAt?:string;evidence?:string;error?:string;warning?:string;media:TakeMedia[];transferredBytes?:number;totalBytes?:number}
export interface VideoTakeState {id:string;name:string;stage:'preparing'|'armed'|'recording'|'stopping'|'review'|'collecting'|'complete'|'attention';createdAt:string;maximumMinutes:number;error?:string;stopRequested?:boolean;startedAt?:string;stoppedAt?:string;startSkewMilliseconds?:number;cameras:TakeCameraState[]}
const message=(error:unknown)=>error instanceof Error?error.message:String(error)
/** Device-independent take lifecycle shared by applications and MCP. No framesync is implied. */
export class VideoTake {
    readonly state:VideoTakeState
    private busy=false
    private stopRequested=false
    private attempted=new Set<string>()
    constructor(id:string,name:string,private readonly devices:Map<string,TakeCamera>,maximumMinutes=30,private readonly publish:(state:VideoTakeState)=>void=()=>{}){
        if(!id||!devices.size||devices.size>64||!Number.isFinite(maximumMinutes)||maximumMinutes<1||maximumMinutes>120)throw new Error('Choose 1–64 cameras and a safety stop of 1–120 minutes')
        this.state={id,name:name.trim().slice(0,100)||'Untitled take',stage:'preparing',createdAt:new Date().toISOString(),maximumMinutes,cameras:[...devices.keys()].map(camera=>({camera,state:'preparing',media:[]}))}
    }
    /** Resume collection from persisted stopped-take evidence; never infer an interrupted stop. */
    static resume(state:VideoTakeState,devices:Map<string,TakeCamera>,publish:(state:VideoTakeState)=>void=()=>{}){
        if(state.cameras.some(camera=>['recording','uncertain','preparing'].includes(camera.state)))throw new Error('Confirm all recording stopped before resuming collection')
        if(state.cameras.some(camera=>!devices.has(camera.camera)))throw new Error('A camera from this take is unavailable')
        const take=new VideoTake(state.id,state.name,devices,state.maximumMinutes,publish)
        Object.assign(take.state,structuredClone(state))
        return take
    }
    private changed(){this.publish(structuredClone(this.state))}
    async prepare(){
        if(this.busy||this.state.stage!=='preparing')throw new Error('This take is already prepared or started')
        this.busy=true;this.changed()
        try{
            await Promise.all(this.state.cameras.map(async state=>{try{await this.devices.get(state.camera)!.prepare();state.state='ready'}catch(error){state.state='error';state.error=message(error)}this.changed()}))
            if(this.stopRequested){await this.closeIdle();this.state.stage='review'}
            else if(this.state.cameras.some(camera=>camera.state!=='ready')){await this.closeIdle();this.state.stage='attention'}
            else this.state.stage='armed'
            this.changed();return this.state
        }finally{this.busy=false}
    }
    async start(){
        if(this.busy||!['preparing','armed'].includes(this.state.stage))throw new Error('This take has already been started')
        if(this.state.stage==='preparing')await this.prepare()
        if(this.state.stage!=='armed')return this.state
        this.busy=true;this.changed()
        try{
            await Promise.all(this.state.cameras.map(async state=>{
                this.attempted.add(state.camera)
                try{const result=await this.devices.get(state.camera)!.start();state.state='recording';state.recordingConfirmed=result.recordingConfirmed;state.evidence=result.evidence;state.startedAt=new Date().toISOString()}
                catch(error){state.state='uncertain';state.error=message(error)}this.changed()
            }))
            if(this.stopRequested||this.state.cameras.some(camera=>camera.state!=='recording')){await this.stopAttempted();this.state.stage=this.stopRequested&&!this.attempted.size?'review':'attention';await this.closeIdle();this.changed();return this.state}
            const times=this.state.cameras.map(camera=>Date.parse(camera.startedAt!))
            this.state.stage='recording';this.state.startedAt=new Date(Math.min(...times)).toISOString();this.state.startSkewMilliseconds=Math.max(...times)-Math.min(...times);this.changed();return this.state
        }finally{this.busy=false}
    }
    private async stopAttempted(){
        await Promise.all(this.state.cameras.filter(state=>this.attempted.has(state.camera)).map(async state=>{
            try{const result=await this.devices.get(state.camera)!.stop();if(!result.stopped)throw new Error('Camera did not confirm recording stopped');state.state='stopped';state.media=result.media;state.warning=result.warning;state.stoppedAt=new Date().toISOString();delete state.error;this.attempted.delete(state.camera)}
            catch(error){state.state='uncertain';state.error=message(error)}this.changed()
        }))
        this.state.stoppedAt=new Date().toISOString()
    }
    /** Stop one camera while the remaining cameras continue their take. */
    async stopCamera(camera:string){
        if(this.busy)throw new Error('A take operation is still running')
        const state=this.state.cameras.find(state=>state.camera===camera)
        if(!state)throw new Error('This camera is not part of the take')
        if(!this.attempted.has(camera))return this.state
        if(!['recording','attention'].includes(this.state.stage))throw new Error('Wait for the take to start before stopping an individual camera')
        this.busy=true;state.state='stopping'
        if(this.attempted.size===1)this.state.stage='stopping'
        this.changed()
        try{
            try{
                const result=await this.devices.get(camera)!.stop()
                if(!result.stopped)throw new Error('Camera did not confirm recording stopped')
                state.state='stopped';state.media=result.media;state.warning=result.warning;state.stoppedAt=new Date().toISOString();delete state.error;this.attempted.delete(camera)
            }catch(error){state.state='uncertain';state.error=message(error)}
            if(this.stopRequested)await this.stopAttempted()
            await this.closeIdle()
            this.state.stage=this.state.cameras.some(camera=>camera.state==='recording')?'recording':this.attempted.size?'attention':'review'
            if(!this.attempted.size)this.state.stoppedAt=new Date().toISOString()
            this.changed();return this.state
        }finally{this.busy=false}
    }
    async stop(){
        if(this.busy)throw new Error('A take operation is still running')
        if(!this.attempted.size){if(['preparing','armed'].includes(this.state.stage)){await this.closeIdle();this.state.stage='review';this.changed()}return this.state}
        this.busy=true;this.state.stage='stopping';this.changed()
        try{await this.stopAttempted();await this.closeIdle();this.state.stage=this.attempted.size?'attention':'review';this.changed();return this.state}finally{this.busy=false}
    }
    async collect(){
        if(this.busy||this.attempted.size||!['review','attention','complete'].includes(this.state.stage))throw new Error('Confirm all cameras stopped before collecting footage')
        if(this.state.stage==='complete')return this.state
        this.busy=true;this.state.stage='collecting';this.changed()
        try{
            // Limit simultaneous large transfers and make retries camera-specific.
            for(const state of this.state.cameras){
                if(state.state==='collected'||!state.media.length)continue
                try{
                    const original=state.media
                    const files=await this.devices.get(state.camera)!.collect(original,(bytes,total)=>{state.transferredBytes=bytes;state.totalBytes=total;this.changed()})
                    if(files.length!==original.length||files.some(file=>!file.verified||!file.downloadUrl||!original.some(source=>source.id===file.id&&source.bytes===file.bytes)))throw new Error('Transferred footage did not match the camera files')
                    state.media=files;state.totalBytes=files.reduce((total,file)=>total+file.bytes,0);state.transferredBytes=state.totalBytes;state.state='collected';delete state.error
                }catch(error){state.error=message(error)}this.changed()
            }
            this.state.stage=this.state.cameras.every(camera=>camera.state==='collected')?'complete':'attention';this.changed();return this.state
        }finally{await this.closeIdle();this.busy=false}
    }
    async closeIdle(){await Promise.allSettled([...this.devices].filter(([camera])=>!this.attempted.has(camera)).map(([,device])=>device.close()))}
    requestStop(){this.stopRequested=true;this.state.stopRequested=true;this.changed()}
    hasUnstoppedCameras(){return this.attempted.size>0}
}
