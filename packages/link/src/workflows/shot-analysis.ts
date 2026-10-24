import {spawn} from 'node:child_process'
export interface ShotMetrics {median:number;p95:number;clipped:number;dark:number;detail:number;neutralPixels:number;redBlueRatio:number}
export interface ShotAnalysis {metrics:ShotMetrics;effectiveIso?:number;exposure:'balanced'|'bright'|'dark';focus:'detail-visible'|'soft';colour:'neutral'|'cast'|'unknown';method:string;durationMilliseconds:number;scene?:{subject:string;focus:boolean;colour:boolean;confidence:number}}

/** Edge contrast describes an image; it cannot prove the selected subject is in focus. */
export function subjectFocusVerified(analysis:ShotAnalysis,cameraAcquired=false):boolean{
 const scene=analysis.scene,reviewed=typeof scene?.subject==='string'&&Boolean(scene.subject.trim())&&Number.isFinite(scene.confidence)&&scene.confidence>=.8
 if(reviewed&&scene!.focus===false)return false
 return cameraAcquired||(reviewed&&scene!.focus===true)
}

function shutterSeconds(value:string):number|undefined{
 const text=value.replace(/\s+\(raw [^)]+\)$/,'').trim()
 const fraction=text.match(/^1\s*\/\s*(\d+(?:\.\d+)?)\s*(?:s|sec)?$/i)
 const seconds=text.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|")$/i)
 const result=fraction?1/Number(fraction[1]):seconds?Number(seconds[1]):NaN
 return Number.isFinite(result)&&result>0?result:undefined
}

/** Choose the closest advertised shutter to a 180-degree shutter angle. */
export function chooseShutterSpeed(allowed:string[],frameRate:number|undefined,current?:string):string|undefined{
 if(!frameRate||!Number.isFinite(frameRate)||frameRate<1||frameRate>1000)return
 const target=1/(2*frameRate),candidates=allowed.map(value=>({value,seconds:shutterSeconds(value)})).filter((item):item is {value:string;seconds:number}=>item.seconds!==undefined)
 let selected:{value:string;distance:number}|undefined
 for(const item of candidates){const distance=Math.abs(Math.log2(item.seconds/target));if(distance>1)continue
  if(!selected||distance<selected.distance-1e-10||(Math.abs(distance-selected.distance)<1e-10&&item.value===current))selected={value:item.value,distance}
 }
 return selected?.value===current?undefined:selected?.value
}
/** Read standard EXIF ISO, so locking Auto ISO preserves the camera's metered exposure. */
export function exifIso(data:Uint8Array):number|undefined{
 try{const b=Buffer.from(data);let offset=2;while(offset+4<b.length){if(b[offset]!==255)break;const marker=b[offset+1],length=b.readUInt16BE(offset+2);if(length<2||offset+length+2>b.length)break;if(marker===225&&b.subarray(offset+4,offset+10).toString()==='Exif\0\0'){
  const base=offset+10,little=b.subarray(base,base+2).toString()==='II',u16=(o:number)=>little?b.readUInt16LE(o):b.readUInt16BE(o),u32=(o:number)=>little?b.readUInt32LE(o):b.readUInt32BE(o)
  const visit=(position:number,depth:number):number|undefined=>{if(depth>1||position<base||position+2>=b.length)return;const count=Math.min(u16(position),200);for(let i=0;i<count;i++){const p=position+2+i*12;if(p+12>b.length)return;const tag=u16(p);if(tag===34855&&u16(p+2)===3&&u32(p+4)===1){const value=u16(p+8);if(value>=25&&value<=204800&&value!==65535)return value}if(tag===34665){const value=visit(base+u32(p+8),depth+1);if(value)return value}}};return visit(base+u32(base+4),0)
 }offset+=length+2}}catch{}return undefined
}
async function reviewScene(image:Uint8Array):Promise<ShotAnalysis['scene']>{
 if(process.env.DARKGRADE_SHOT_VISION==='0')return
 try{
  const running=await fetch('http://127.0.0.1:11434/api/ps',{signal:AbortSignal.timeout(200)}).then(r=>r.json())
  const model=running.models?.find((m:any)=>/qwen3\.5|llava|gemma[34]/i.test(m.name))?.name
  if(!model)return // Never cold-load a model in the critical camera path.
  const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',signal:AbortSignal.timeout(2500),headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:false,think:false,keep_alive:'30m',options:{num_predict:120,temperature:0},format:{type:'object',properties:{subject:{type:'string'},focus:{type:'boolean'},colour:{type:'boolean'},confidence:{type:'number'}},required:['subject','focus','colour','confidence']},messages:[{role:'user',content:'Inspect this camera reference. Is the principal subject visibly sharp and does colour look plausible? Return confidence 0–1. Say false for focus if no clear subject or detail; never infer focus from background edges. Keep subject under eight words.',images:[Buffer.from(image).toString('base64')]}]})})
  if(!response.ok)return;const result=JSON.parse((await response.json()).message.content)
  if(typeof result.subject==='string'&&typeof result.focus==='boolean'&&typeof result.colour==='boolean'&&Number.isFinite(result.confidence)&&result.confidence>=0&&result.confidence<=1)return {...result,subject:result.subject.slice(0,100)}
 }catch{}return undefined
}
export function measureShot(rgb:Uint8Array,width:number,height:number):ShotMetrics {
 if(width<8||height<8||rgb.length!==width*height*3)throw new Error('Invalid visual reference')
 const values:number[]=[],luma=new Float32Array(width*height);let clipped=0,dark=0,detail=0,edges=0,neutral=0,red=0,blue=0
 const highlightBins=new Uint32Array(256);let aboveVideoWhite=0
 // Exclude HDMI overlays and borders from metering.
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=y*width+x,o=i*3;luma[i]=(.2126*rgb[o]+.7152*rgb[o+1]+.0722*rgb[o+2])/255}
 for(let y=Math.floor(height*.15);y<height*.85;y++)for(let x=Math.floor(width*.15);x<width*.85;x++){
  const i=y*width+x,o=i*3,v=luma[i];values.push(v);if(v>.97)clipped++;if(v<.04)dark++
  // Some HDMI capture paths preserve legal-range white (235) inside JPEG.
  // Detect a broad neutral plateau, not merely a bright percentile or white wall.
  const minimum=Math.min(rgb[o],rgb[o+1],rgb[o+2]),maximum=Math.max(rgb[o],rgb[o+1],rgb[o+2])
  if(maximum-minimum<=3)highlightBins[Math.round(v*255)]++
  if(v>240/255)aboveVideoWhite++
  const lap=4*v-luma[i-1]-luma[i+1]-luma[i-width]-luma[i+width];detail+=lap*lap;edges++
  const channels=[rgb[o],rgb[o+1],rgb[o+2]],max=Math.max(...channels),min=Math.min(...channels)
  if(max>40&&max<235&&(max-min)/max<.18){neutral++;red+=rgb[o];blue+=rgb[o+2]}
 }
 const videoWhitePeak=Math.max(...highlightBins.subarray(233,238))
 if(videoWhitePeak/values.length>.025&&aboveVideoWhite/values.length<.005)clipped=Math.max(clipped,videoWhitePeak)
 values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length*.5)],p95:values[Math.floor(values.length*.95)],clipped:clipped/values.length,dark:dark/values.length,detail:detail/edges,neutralPixels:neutral/values.length,redBlueRatio:blue?red/blue:1}
}
export function describeShot(metrics:ShotMetrics):Pick<ShotAnalysis,'exposure'|'focus'|'colour'>{return {exposure:metrics.clipped>.025||metrics.median>.72?'bright':((metrics.median<.08&&metrics.p95<.4)||(metrics.median<.16&&metrics.dark>.25&&metrics.p95<.8))?'dark':'balanced',focus:metrics.detail>.00035?'detail-visible':'soft',colour:metrics.neutralPixels<.03?'unknown':metrics.redBlueRatio>.85&&metrics.redBlueRatio<1.18?'neutral':'cast'}}
export async function analyseShot(image:Uint8Array,vision=true,reviewer:(image:Uint8Array)=>Promise<ShotAnalysis['scene']>=reviewScene):Promise<ShotAnalysis>{
 const started=Date.now(),width=160,height=90
 // Keep each decoder on standard pipes. Extra output descriptors can close
 // intermittently under the bench runtime and discard an otherwise valid shot.
 const decode=(output:string[],maximum:number)=>new Promise<Buffer>((resolve,reject)=>{
  const child=spawn(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-i','pipe:0','-map','0:v:0',...output],{stdio:['pipe','pipe','pipe']})
  const chunks:Buffer[]=[];let bytes=0,error='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Visual analysis exceeded its three-second budget'))},Math.max(1,3000-(Date.now()-started)))
  child.stdin.on('error',()=>{});child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes<=maximum)chunks.push(chunk);else child.kill('SIGKILL')});child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-500)})
  child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(chunks)):reject(new Error(error||'Could not decode visual reference'))});child.stdin.end(image)
 })
 const [raw,thumbnail]=await Promise.all([
  decode(['-vf',`scale=${width}:${height}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],width*height*3),
  vision?decode(['-vf','scale=512:-2','-frames:v','1','-c:v','mjpeg','-f','image2pipe','pipe:1'],512000):Promise.resolve(Buffer.alloc(0)),
 ])
 const metrics=measureShot(raw,width,height),scene=vision&&thumbnail.length?await reviewer(thumbnail):undefined,result:ShotAnalysis={metrics,effectiveIso:exifIso(image),...describeShot(metrics),scene,method:scene?'Image measurements with local vision-model subject review':'Measured image histogram, clipping, neutral pixels and edge detail',durationMilliseconds:Date.now()-started}
 return result
}
/** Only choose values the camera advertises; never extrapolate an unsupported setting. */
export function chooseIso(allowed:string[],current:string|undefined,analysis:ShotAnalysis):string|undefined{
 const candidates=allowed.map(value=>({value,iso:Number(value.replace(/^ISO\s*/i,''))})).filter(item=>Number.isFinite(item.iso)&&item.iso>=100&&item.iso<=25600).sort((a,b)=>a.iso-b.iso)
 if(!candidates.length)return undefined
 const original=Number((current||'').replace(/^ISO\s*/i,'')),baseline=Number.isFinite(original)&&original>0?original:analysis.effectiveIso||400
 const desired=analysis.exposure==='bright'?baseline*Math.min(.5,Math.max(.0625,Math.pow(.38/Math.max(.38,analysis.metrics.median),2.2)),analysis.metrics.clipped>.15?.125:analysis.metrics.clipped>.025?.25:.5):analysis.exposure==='dark'?baseline*(analysis.metrics.median<.08?4:2):baseline
 const selected=candidates.reduce((a,b)=>Math.abs(Math.log2(a.iso/desired))<Math.abs(Math.log2(b.iso/desired))?a:b).value
 return selected===current?undefined:selected
}
