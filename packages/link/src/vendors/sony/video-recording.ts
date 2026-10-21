import {sonyMovieCard} from '@vendors/sony/recording-slots'
import type {TakeMedia} from '@workflows/video-take'
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds))
/** Camera-card take over the same official Sony SDK connection on USB or Wi-Fi. */
export class SonyVideoRecording {
    private baseline=new Set<string>()
    private attempted=false
    constructor(private readonly camera:any){}
    async prepare(){
        if((await this.camera.getSonyProperty('RecordingState')).value!=='0')throw new Error('This camera is already recording')
        if((await sonyMovieCard(this.camera)).status!=='ready')throw new Error('Insert a usable card in the selected movie slot')
        this.baseline=new Set((await this.camera.getRecentSonyContents()).map((content:any)=>String(content.id)))
    }
    async start(){
        this.attempted=true;await this.camera.startRecording()
        const deadline=Date.now()+5000
        do{const state=await this.camera.getSonyProperty('RecordingState');if(state.value==='1')return {recordingConfirmed:true,evidence:'Sony SDK reports recording'};if(state.value==='2')throw new Error('Camera reports recording failed');await sleep(100)}while(Date.now()<deadline)
        throw new Error('Camera did not confirm recording started')
    }
    async stop(){
        if(!this.attempted)return {stopped:true,media:[] as TakeMedia[]}
        await this.camera.stopRecording()
        const deadline=Date.now()+15000
        let idle=false,retried=false
        do{const state=await this.camera.getSonyProperty('RecordingState');if(state.value==='0'){idle=true;break};if(!retried){await this.camera.stopRecording();retried=true};await sleep(200)}while(Date.now()<deadline)
        if(!idle)throw new Error('Camera did not confirm recording stopped; do not disconnect power')
        this.attempted=false
        const filesDeadline=Date.now()+15000
        let media:TakeMedia[]=[]
        do{
            try{
                const contents=await this.camera.getRecentSonyContents()
                media=contents.filter((content:any)=>!this.baseline.has(String(content.id))).flatMap((content:any)=>(content.files||[]).filter((file:any)=>/\.(mp4|mov|mxf)$/i.test(file.name)&&Number(file.bytes)>0).map((file:any)=>({id:`${content.id}:${file.id}`,filename:String(file.name).split(/[\\/]/).pop()||'camera-video.mp4',bytes:Number(file.bytes),verified:true})))
            }catch{ /* Sony's content index may lag file finalization. */ }
            if(media.length)break
            await sleep(300)
        }while(Date.now()<filesDeadline)
        return {stopped:true,media,...(!media.length?{warning:'Camera stopped; its movie index is not ready for collection. The original remains on the card.'}:{})}
    }
    async transfer(file:TakeMedia,directory:string,filename:string){
        const [contentId,fileId]=file.id.split(':').map(Number)
        const contents=await this.camera.getRecentSonyContents()
        const source=contents.find((content:any)=>Number(content.id)===contentId)?.files?.find((item:any)=>Number(item.id)===fileId)
        if(!source||String(source.name).split(/[\\/]/).pop()!==String(file.filename).split(/[\\/]/).pop()||Number(source.bytes)!==file.bytes)throw new Error('Camera file identity changed; transfer refused')
        return this.camera.downloadSonyContent(contentId,fileId,directory,filename)
    }
    async cleanup(){if(this.attempted)await this.stop()}
}
