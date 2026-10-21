export interface TakeMedia {id:string;filename:string;bytes:number;downloadUrl?:string;verified:boolean}
export interface TakeCamera {
    prepare():Promise<void>
    start():Promise<{recordingConfirmed:boolean;evidence:string}>
    stop():Promise<{stopped:boolean;media:TakeMedia[];warning?:string}>
    collect(media:TakeMedia[],progress:(bytes:number,total:number)=>void):Promise<TakeMedia[]>
    close():Promise<void>
}
export interface TakeCameraState {camera:string;state:'preparing'|'ready'|'recording'|'stopped'|'collected'|'error'|'uncertain';recordingConfirmed?:boolean;startedAt?:string;stoppedAt?:string;evidence?:string;error?:string;warning?:string;media:TakeMedia[];transferredBytes?:number;totalBytes?:number}
export interface VideoTakeState {id:string;name:string;stage:'preparing'|'recording'|'stopping'|'review'|'collecting'|'complete'|'attention';createdAt:string;maximumMinutes:number;error?:string;stopRequested?:boolean;startedAt?:string;stoppedAt?:string;startSkewMilliseconds?:number;cameras:TakeCameraState[]}
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
    async start(){
        if(this.busy||this.state.stage!=='preparing')throw new Error('This take has already been started')
        this.busy=true;this.changed()
        try{
            await Promise.all(this.state.cameras.map(async state=>{try{await this.devices.get(state.camera)!.prepare();state.state='ready'}catch(error){state.state='error';state.error=message(error)}this.changed()}))
            if(this.stopRequested){this.state.stage='review';await this.closeIdle();this.changed();return this.state}
            if(this.state.cameras.some(camera=>camera.state!=='ready')){this.state.stage='attention';await this.closeIdle();this.changed();return this.state}
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
            try{const result=await this.devices.get(state.camera)!.stop();if(!result.stopped)throw new Error('Camera did not confirm recording stopped');state.state='stopped';state.media=result.media;state.warning=result.warning;state.stoppedAt=new Date().toISOString();this.attempted.delete(state.camera)}
            catch(error){state.state='uncertain';state.error=message(error)}this.changed()
        }))
        this.state.stoppedAt=new Date().toISOString()
    }
    async stop(){
        if(this.busy)throw new Error('A take operation is still running')
        if(!this.attempted.size)return this.state
        this.busy=true;this.state.stage='stopping';this.changed()
        try{await this.stopAttempted();this.state.stage=this.attempted.size?'attention':'review';await this.closeIdle();this.changed();return this.state}finally{this.busy=false}
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
                    state.media=files;state.state='collected';delete state.error
                }catch(error){state.error=message(error)}this.changed()
            }
            this.state.stage=this.state.cameras.every(camera=>camera.state==='collected')?'complete':'attention';this.changed();return this.state
        }finally{await this.closeIdle();this.busy=false}
    }
    async closeIdle(){await Promise.allSettled([...this.devices].filter(([camera])=>!this.attempted.has(camera)).map(([,device])=>device.close()))}
    requestStop(){this.stopRequested=true;this.state.stopRequested=true;this.changed()}
    hasUnstoppedCameras(){return this.attempted.size>0}
}
