import type { StatePhase } from '@darkgrade/contribute/protocol'
/** The existing event cache is the only input; no extra USB commands, waits or cloud calls. */
function diagnosticState(camera:any,phase:StatePhase){
 try{camera.getInstance?.().recordStateSnapshot?.('recording',phase)}catch{}
}
export interface CanonRecordingSettings {mode:number;iso?:string;aperture?:string;shutterSpeed?:string;whiteBalance?:string;settingsMatched:boolean}
const properties={iso:['CanonIso','setIso'],aperture:['CanonAperture','setAperture'],shutterSpeed:['CanonShutterSpeed','setShutterSpeed'],whiteBalance:['CanonWhiteBalance','setWhiteBalance']} as const
async function snapshot(camera:any):Promise<CanonRecordingSettings>{
 const states=await camera.getCanonPropertyStates(),get=(name:string)=>states.find((state:any)=>state.name===name)?.value
 return {mode:Number(get('CanonAutoExposureMode')),iso:get('CanonIso'),aperture:get('CanonAperture'),shutterSpeed:get('CanonShutterSpeed'),whiteBalance:get('CanonWhiteBalance'),settingsMatched:false}
}
async function copySettings(camera:any,before:CanonRecordingSettings){
 if(before.mode!==3)return
 await camera.setCanonManualExposureMode()
 for(const [key,[name,method]] of Object.entries(properties)){
  const value=before[key as keyof typeof properties]
  if(value===undefined)continue
  const state=(await camera.getCanonPropertyStates()).find((state:any)=>state.name===name)
  if(String(state?.value)===value)continue
  if(!state?.allowedValues?.map(String).includes(value))throw new Error(`Canon movie mode did not advertise the selected ${key}: ${value}`)
  await camera[method](value)
  const observed=(await camera.getCanonPropertyStates()).find((state:any)=>state.name===name)?.value
  if(String(observed)!==value)throw new Error(`Canon ${key} readback changed during the movie-mode transition`)
 }
}
/** Movie-select On/Off can reset AE to the physical dial. Copy and verify manual settings both ways. */
export async function withCanonRecordingMode<T>(camera:any,record:(settings:CanonRecordingSettings)=>Promise<T>,idle:()=>boolean=()=>true):Promise<T>{
 diagnosticState(camera,'before-prepare')
 let before:CanonRecordingSettings|undefined,entered=false,restoreDestination:(()=>Promise<void>)|undefined,failure:unknown
 try{
  before=await snapshot(camera)
  const movie=(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
  restoreDestination=await camera.prepareCanonRecordingDestination?.()
  if(!movie){await camera.enterMovieMode();entered=true;await new Promise(resolve=>setTimeout(resolve,700))}
  await copySettings(camera,before)
  await camera.ensureCanonMovieSoundRecording?.()
  const actual=await snapshot(camera)
  actual.settingsMatched=before.mode===3&&actual.mode===3&&Object.keys(properties).every(key=>before![key as keyof typeof properties]===actual[key as keyof typeof properties])
  diagnosticState(camera,'after-prepare')
  return await record(actual)
 }catch(error){failure=error;diagnosticState(camera,'failure');throw error}
 finally{
  // Do not change modes while a failed stop leaves recording uncertain.
  if(idle()){
   try{
    if(entered&&before){await camera.leaveMovieMode();await copySettings(camera,before)}
    await restoreDestination?.()
   }catch(cleanup){diagnosticState(camera,'failure');if(failure)throw new AggregateError([failure,cleanup],'Canon recording and restoration failed');throw cleanup}
   finally{diagnosticState(camera,'after-cleanup')}
  }
 }
}

/** Hold a verified still mode through capture and transfer, restoring the operator's movie mode afterward. */
export async function withCanonPhotoMode<T>(camera:any,capture:()=>Promise<T>):Promise<T>{
 const movie=async()=>(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
 if(!await movie())return capture()
 const before=await snapshot(camera)
 let failure:unknown
 try{
  await camera.leaveMovieMode()
  await new Promise(resolve=>setTimeout(resolve,700))
  if(await movie())throw new Error('Set the Canon body’s physical still/movie selector to Photo; it retained movie mode after the remote Photo command')
  return await capture()
 }catch(error){failure=error;throw error}
 finally{
  try{
   if(!await movie()){
    await camera.enterMovieMode()
    await new Promise(resolve=>setTimeout(resolve,700))
    if(!await movie())throw new Error('Canon did not restore movie mode')
   }
   await copySettings(camera,before)
  }catch(error){
   if(failure)throw new AggregateError([failure,error],`${String(failure)}; restoring movie mode: ${String(error)}`)
   throw error
  }
 }
}

/** Read actual movie choices without copying photo-only values into movie mode. */
export async function probeCanonRecordingControls(camera:any){
 const before=await snapshot(camera)
 const movie=(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
 let entered=false
 try{
  if(!movie){await camera.enterMovieMode();entered=true;await new Promise(resolve=>setTimeout(resolve,700))}
  if(before.mode===3)await camera.setCanonManualExposureMode()
  return await camera.getCanonPropertyStates()
 }finally{
  if(entered){await camera.leaveMovieMode();await copySettings(camera,before)}
 }
}
/** Auto setup must choose values shared by the reference still and the movie. */
export function restrictToRecordingChoices<T extends Record<string,any>>(controls:T,movie:T):T{
 const constrained={...controls}
 for(const key of Object.keys(properties)){
  const source=controls[key],target=movie[key]
  if(!source)continue
  const shared=(source.allowedValues||[]).filter((value:any)=>target?.allowedValues?.map(String).includes(String(value)))
  ;(constrained as any)[key]={...source,allowedValues:shared,writable:source.writable!==false&&target?.writable!==false&&shared.length>0}
 }
 return constrained
}

/** Hold movie-select mode across operator-controlled start/stop without changing a running recorder. */
export async function openCanonRecordingMode(camera:any){
 diagnosticState(camera,'before-prepare')
 let before:CanonRecordingSettings|undefined,entered=false,restoreDestination:(()=>Promise<void>)|undefined
 const restore=async()=>{
  try{
   if(entered&&before){await camera.leaveMovieMode();await copySettings(camera,before);entered=false}
   await restoreDestination?.()
  }catch(error){diagnosticState(camera,'failure');throw error}
  finally{diagnosticState(camera,'after-cleanup')}
 }
 try{
  before=await snapshot(camera)
  const alreadyMovie=(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
  restoreDestination=await camera.prepareCanonRecordingDestination?.()
  if(!alreadyMovie){await camera.enterMovieMode();entered=true;await new Promise(resolve=>setTimeout(resolve,700))}
  await copySettings(camera,before)
  await camera.ensureCanonMovieSoundRecording?.()
  diagnosticState(camera,'after-prepare')
 }catch(error){
  diagnosticState(camera,'failure')
  try{await restore()}catch(cleanup){throw new AggregateError([error,cleanup],'Canon recording preparation and restoration failed')}
  throw error
 }
 return {restore}
}
