import {sonyMovieCard} from '@vendors/sony/recording-slots'
import type {TakeMedia} from '@workflows/video-take'
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds))
/** Camera-card take over the same official Sony SDK connection on USB or Wi-Fi. */
export class SonyVideoRecording {
    private baseline=new Set<string>()
    private attempted=false
    constructor(private camera:any,private readonly refreshCamera?:()=>Promise<any>){}
    async prepare(){
        if((await this.camera.getSonyProperty('RecordingState')).value!=='0')throw new Error('This camera is already recording')
        if((await sonyMovieCard(this.camera)).status!=='ready')throw new Error('Insert a usable card in the selected movie slot')
        this.baseline=new Set((await this.camera.getRecentSonyContents({all:true})).flatMap((content:any)=>(content.files||[]).map((file:any)=>JSON.stringify([String(file.name),String(file.bytes)]))))
    }
    private newMovies(contents:any[]):TakeMedia[]{
        return contents.flatMap((content:any)=>(content.files||[]).filter((file:any)=>/\.(mp4|mov|mxf)$/i.test(file.name)&&Number(file.bytes)>0&&!this.baseline.has(JSON.stringify([String(file.name),String(file.bytes)]))).map((file:any)=>({id:`${content.id}:${file.id}`,filename:String(file.name).split(/[\\/]/).pop()||'camera-video.mp4',bytes:Number(file.bytes),verified:true})))
    }
    async start(){
        this.attempted=true;await this.camera.startRecording()
        const deadline=Date.now()+5000
        do{const state=await this.camera.getSonyProperty('RecordingState');if(state.value==='1')return {recordingConfirmed:true,evidence:'Sony SDK reports recording'};if(state.value==='2')throw new Error('Camera reports recording failed');await sleep(100)}while(Date.now()<deadline)
        throw new Error('Camera did not confirm recording started')
    }
    private async confirmStopped(){
        for(let connection=0;connection<2;connection++){
            try{
                await this.camera.stopRecording()
                const started=Date.now(),deadline=started+15000
                let retried=false
                do{
                    await sleep(200)
                    const state=await this.camera.getSonyProperty('RecordingState')
                    if(state.value==='0')return
                    if(!retried&&Date.now()-started>=1500){await this.camera.stopRecording();retried=true}
                }while(Date.now()<deadline)
                throw new Error('Camera did not confirm recording stopped; do not disconnect power')
            }catch(error){
                if(connection||!this.refreshCamera)throw error
                // Renew only the SDK session; the owning adapter must preserve camera power and USB.
                this.camera=await this.refreshCamera()
            }
        }
    }
    getRecoveryState(){return {version:1,kind:'sony',baseline:[...this.baseline]}}
    async stopInterrupted(recovery?:unknown){
        const saved=recovery as {version?:number;kind?:string;baseline?:unknown[]}|undefined
        if(saved?.version===1&&saved.kind==='sony'&&Array.isArray(saved.baseline)&&saved.baseline.length<=10000&&saved.baseline.every(value=>typeof value==='string'&&value.length<=4096)){
            this.baseline=new Set(saved.baseline as string[]);this.attempted=true
            return this.stop()
        }
        await this.confirmStopped();this.attempted=false
        return {stopped:true,media:[] as TakeMedia[],warning:'Interrupted recording stopped. Copy any unindexed original directly from the camera card.'}
    }
    async stop(){
        if(!this.attempted)return {stopped:true,media:[] as TakeMedia[]}
        await this.confirmStopped();this.attempted=false
        const filesDeadline=Date.now()+15000
        let media:TakeMedia[]=[]
        do{
            try{
                const contents=await this.camera.getRecentSonyContents({all:true})
                media=this.newMovies(contents)
            }catch{ /* Sony's content index may lag file finalization. */ }
            if(media.length)break
            await sleep(300)
        }while(Date.now()<filesDeadline)
        let refreshFailed=false
        if(!media.length&&this.refreshCamera){
            try{
                this.camera=await this.refreshCamera()
                const contents=await this.camera.getRecentSonyContents({all:true})
                media=this.newMovies(contents)
            }catch{refreshFailed=true}
        }
        return {stopped:true,media,...(!media.length?{warning:refreshFailed?'Camera stopped; refreshing its SDK content index failed. The original remains on the card.':'Camera stopped; its movie index is not ready for collection. The original remains on the card.'}:{})}
    }
    async transfer(file:TakeMedia,directory:string,filename:string){
        if((await this.camera.getSonyProperty('RecordingState')).value!=='0')throw new Error('Stop recording before transferring footage')
        const [contentId,fileId]=file.id.split(':').map(Number)
        const contents=await this.camera.getRecentSonyContents({all:true})
        const source=contents.find((content:any)=>Number(content.id)===contentId)?.files?.find((item:any)=>Number(item.id)===fileId)
        if(!source||String(source.name).split(/[\\/]/).pop()!==String(file.filename).split(/[\\/]/).pop()||Number(source.bytes)!==file.bytes)throw new Error('Camera file identity changed; transfer refused')
        return this.camera.downloadSonyContent(contentId,fileId,directory,filename)
    }
    async cleanup(){if(this.attempted)await this.stop()}
}
