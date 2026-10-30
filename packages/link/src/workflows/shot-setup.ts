import {analyseShot,chooseIso,chooseShutterSpeed,subjectFocusVerified,type ShotAnalysis} from '@workflows/shot-analysis'
export interface ShotSetupReport {status:'verified'|'attention'|'unavailable';summary:string;durationMilliseconds:number;changes:{setting:string;before:string;after:string;verified:boolean;reverted?:boolean;attempted?:string}[];analysis?:ShotAnalysis;before?:ShotAnalysis;error?:string;budgetExceeded?:boolean;imageVerified?:boolean;focusVerified?:boolean;exposureVerified?:boolean}
export interface ShotProperty {value?:string;allowedValues?:string[];writable?:boolean;enabled?:boolean}
export async function optimiseShot(options:{image:Uint8Array;controls:Record<string,ShotProperty|undefined>;frameRate?:number;focusRequested?:boolean;repairFocusMode?:boolean;budgetMilliseconds?:number;focusEvidence?:{focusAcquired?:boolean};tuneWhiteBalance?:boolean;whiteBalanceTarget?:string;apply:(action:string,value:string)=>Promise<Record<string,ShotProperty|undefined>>;recapture:()=>Promise<Uint8Array>;focus?:()=>Promise<any>;publish:(stage:string)=>void;analyse?:(image:Uint8Array,vision?:boolean)=>Promise<ShotAnalysis>}):Promise<ShotSetupReport>{
 const started=Date.now(),deadline=started+Math.min(60000,Math.max(10000,options.budgetMilliseconds||20000)),changes:ShotSetupReport['changes']=[];let controls=options.controls,lastError:string|undefined
 const analyse=options.analyse||analyseShot
 const before=await analyse(options.image,false);let analysis=before,imageVerified=true,focused=false,focusVerified=false,cameraAcquired=options.focusEvidence?.focusAcquired===true
 const targetMedian=before.exposure==='balanced'?Math.max(.22,Math.min(.42,before.metrics.median)):.3
 const needsMeterCorrection=()=>analysis.metrics.median<targetMedian*.7&&analysis.metrics.p95<.9
 const acceptableExposure=()=>analysis.exposure==='balanced'&&!needsMeterCorrection()
 const report=():ShotSetupReport=>({exposureVerified:acceptableExposure()&&imageVerified&&changes.filter(change=>['iso','shutterSpeed','aperture','exposureMode'].includes(change.setting)).every(change=>change.verified)&&['iso','shutterSpeed'].every(key=>Boolean(controls[key]?.value)&&!/auto|unknown|bulb/i.test(controls[key]!.value!))&&Number(controls.iso?.value?.replace(/^ISO\s*/i,''))>0,status:acceptableExposure()&&imageVerified&&changes.every(change=>change.verified)&&['iso','shutterSpeed'].every(key=>Boolean(controls[key]?.value)&&!/auto|unknown|bulb/i.test(controls[key]!.value!))&&(!options.focusRequested||focusVerified)&&(!options.tuneWhiteBalance||!options.whiteBalanceTarget||controls.whiteBalance?.value===options.whiteBalanceTarget)&&Number(controls.iso?.value?.replace(/^ISO\s*/i,''))>0?'verified':'attention',summary:analysis.exposure==='balanced'?'Exposure measured within range; supported exposure settings verified':'Scene still needs attention; automatic tuning stopped at its limit',durationMilliseconds:Date.now()-started,changes,before,analysis,imageVerified,focusVerified,error:lastError,budgetExceeded:Date.now()>deadline})
 const set=async(key:string,action:string,value:string|undefined)=>{const p=controls[key];if(lastError||!value||value===p?.value||Date.now()>=deadline)return;if(p?.writable===false||p?.enabled===false||!p?.allowedValues?.includes(value)){lastError=key+' cannot be adjusted in the camera’s current mode';return;}options.publish(`Locking ${key}: ${value}`);imageVerified=false;const original=String(p.value??'Unknown');try{controls=await options.apply(action,value);changes.push({setting:key,before:original,after:value,verified:String(controls[key]?.value)===value})}catch(error){lastError=error instanceof Error?error.message:String(error);changes.push({setting:key,before:original,after:value,verified:false})}}
 // Fixed frame cadence and metered ISO avoid brightness drift during a take.
 const shutter=chooseShutterSpeed(controls.shutterSpeed?.allowedValues||[],options.frameRate,controls.shutterSpeed?.value)
 await set('shutterSpeed','set-shutter-speed',shutter)
 await set('iso','set-iso',chooseIso(controls.iso?.allowedValues||[],controls.iso?.value,before))
 if(!lastError&&(!(Number(controls.iso?.value?.replace(/^ISO\s*/i,''))>0)||before.exposure!=='balanced')&&!(controls.iso?.allowedValues||[]).some(value=>Number(value.replace(/^ISO\s*/i,''))>0))lastError='ISO choices are unavailable; enable remote Manual exposure before tuning'
 if((before.exposure==='dark'||needsMeterCorrection())&&before.metrics.median<.16&&Number(controls.iso?.value?.replace(/^ISO\s*/i,''))>=12800){const aperture=Number(controls.aperture?.value?.replace(/^f\//i,'')),candidates=(controls.aperture?.allowedValues||[]).map(value=>({value,f:Number(value.replace(/^f\//i,''))})).filter(candidate=>candidate.f>0&&candidate.f<aperture&&candidate.f>=aperture/Math.SQRT2-.15).sort((a,b)=>a.f-b.f);await set('aperture','set-aperture',candidates[0]?.value)}
 // A scene's illumination cannot be inferred from Auto WB. Preserve it unless
 // the caller explicitly authorizes a particular advertised, scene-based target.
 if(options.tuneWhiteBalance&&options.whiteBalanceTarget)await set('whiteBalance','set-white-balance',options.whiteBalanceTarget)
 if(options.focusRequested&&options.repairFocusMode&&/manual|\bmf\b/i.test(controls.focusMode?.value||'')){
  const automatic=(controls.focusMode?.allowedValues||[]).find(value=>/single|one.shot|af-s/i.test(value))||(controls.focusMode?.allowedValues||[]).find(value=>/auto|continuous|af-c/i.test(value))
  await set('focusMode','set-focus-mode',automatic)
 }
 const manualFocus=/manual|\bmf\b/i.test(controls.focusMode?.value||'')
 if((options.focusRequested||before.focus==='soft')&&(options.focusRequested||before.metrics.median>.03||changes.length>0)&&options.focus&&!manualFocus&&Date.now()<deadline){options.publish('Focusing the subject');focused=true;imageVerified=false;cameraAcquired=false;try{const focus=await options.focus();cameraAcquired=focus?.focusAcquired===true}catch(error){lastError='Autofocus could not be verified: '+(error instanceof Error?error.message:String(error))}}
 if((changes.length||focused)&&Date.now()<deadline){options.publish('Verifying the adjusted shot');try{analysis=await analyse(await options.recapture());imageVerified=true}catch(error){lastError=error instanceof Error?error.message:String(error)}}
 if(!changes.length&&!focused&&Date.now()<deadline)analysis=await analyse(options.image,true)
 const isoNumber=(value:string|undefined)=>Number(value?.replace(/^ISO\s*/i,''))
 const measuredExposure=()=>needsMeterCorrection()?'dark':analysis.exposure
 const isoMeasurements=new Map<number,ShotAnalysis['exposure']>()
 if(imageVerified&&isoNumber(controls.iso?.value)>0)isoMeasurements.set(isoNumber(controls.iso?.value),measuredExposure())
 const visitedIso=new Set([options.controls.iso?.value,...changes.filter(change=>change.setting==='iso'&&change.verified).map(change=>change.after)])
 // Auto ISO can hide the body's actual gain. Use the first fixed-ISO image for one bounded correction.
 for(let correction=0;correction<3&&imageVerified&&!lastError&&(analysis.exposure!=='balanced'||needsMeterCorrection())&&Date.now()+4000<deadline;correction++){
  const count=changes.length
  let nextIso=chooseIso(controls.iso?.allowedValues||[],controls.iso?.value,analysis)
  if(analysis.exposure==='balanced'&&needsMeterCorrection()){const desired=isoNumber(controls.iso?.value)*Math.min(8,Math.pow(targetMedian/Math.max(.01,analysis.metrics.median),2.2));nextIso=(controls.iso?.allowedValues||[]).filter(value=>isoNumber(value)>=100&&isoNumber(value)<=25600).sort((left,right)=>Math.abs(Math.log(isoNumber(left)/desired))-Math.abs(Math.log(isoNumber(right)/desired)))[0]}
  const currentIso=isoNumber(controls.iso?.value)
  const brightening=analysis.exposure==='dark'||needsMeterCorrection()
  const opposite=[...isoMeasurements].filter(([iso,exposure])=>brightening?exposure==='bright'&&iso>currentIso:exposure==='dark'&&iso<currentIso).sort(([left],[right])=>Math.abs(Math.log(left/currentIso))-Math.abs(Math.log(right/currentIso)))[0]?.[0]
  if(nextIso&&opposite&&(brightening?isoNumber(nextIso)>=opposite:isoNumber(nextIso)<=opposite)){
   const target=Math.sqrt(currentIso*opposite)
   nextIso=(controls.iso?.allowedValues||[]).filter(value=>!visitedIso.has(value)&&isoNumber(value)>Math.min(currentIso,opposite)&&isoNumber(value)<Math.max(currentIso,opposite)).sort((left,right)=>Math.abs(Math.log(isoNumber(left)/target))-Math.abs(Math.log(isoNumber(right)/target)))[0]
  }
  if(nextIso&&visitedIso.has(nextIso)){
   const number=(value:string|undefined)=>Number(value?.replace(/^ISO\s*/i,''))
   const current=number(controls.iso?.value),proposed=number(nextIso),target=Math.sqrt(current*proposed)
   nextIso=(controls.iso?.allowedValues||[]).filter(value=>!visitedIso.has(value)&&number(value)>Math.min(current,proposed)&&number(value)<Math.max(current,proposed)).sort((a,b)=>Math.abs(Math.log(number(a)/target))-Math.abs(Math.log(number(b)/target)))[0]
  }
  await set('iso','set-iso',nextIso)
  if(controls.iso?.value)visitedIso.add(controls.iso.value)
  if(changes.length>count&&Date.now()<deadline){options.publish('Verifying exposure correction');try{analysis=await analyse(await options.recapture());imageVerified=true;if(isoNumber(controls.iso?.value)>0)isoMeasurements.set(isoNumber(controls.iso?.value),measuredExposure())}catch(error){lastError=error instanceof Error?error.message:String(error)}}
 }
 // A preset that introduced a visible colour regression is not retained.
 const balance=changes.find(change=>change.setting==='whiteBalance')
 if(balance&&(analysis.colour==='cast'||(analysis.scene?.confidence!==undefined&&analysis.scene.confidence>=.8&&analysis.scene.colour===false)||(analysis.metrics.neutralPixels<before.metrics.neutralPixels*.4&&before.metrics.neutralPixels>.1))){
  balance.attempted=balance.after;balance.reverted=true;imageVerified=false
  try{controls=await options.apply('set-white-balance',balance.before);balance.after=balance.before;balance.verified=String(controls.whiteBalance?.value)===balance.before;if(Date.now()<deadline){analysis=await analyse(await options.recapture());imageVerified=true}}catch(error){balance.verified=false;lastError=error instanceof Error?error.message:String(error)}
 }
 focusVerified=imageVerified&&subjectFocusVerified(analysis,cameraAcquired)&&!(options.focusRequested&&manualFocus)
 const result=report();if(Date.now()>=deadline){result.status='attention';result.budgetExceeded=true;result.summary='Automatic setup exceeded its verification time budget'};if(analysis.exposure==='dark'&&Number(controls.iso?.value?.replace(/^ISO\s*/i,''))>=12800)result.summary='Scene remains too dark at the automatic gain limit; add light or reframe';if(lastError){result.status='attention';result.summary='Automatic setup could not finish: '+lastError};if(!lastError&&result.status==='attention'&&analysis.exposure==='balanced')result.summary=imageVerified?'Exposure measured; some settings or focus still need attention':'Settings changed, but a fresh verification image was not obtained';if(changes.length&&!result.analysis)result.status='attention'
 if(!lastError&&!acceptableExposure()&&analysis.exposure==='balanced'){result.status='attention';result.summary='Exposure remains too dark after adjustment; add light or open the aperture'}
 if(changes.some(change=>!change.verified)){result.status='attention';result.summary='A requested setting was not confirmed by the camera'}
 if(Date.now()>=deadline&&result.status!=='verified'&&!result.exposureVerified){result.summary='Automatic setup needs another exposure correction; camera or image verification was too slow'}
 return result
}
