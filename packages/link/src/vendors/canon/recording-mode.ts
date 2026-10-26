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
 const before=await snapshot(camera)
 const movie=(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
 let entered=false
 try{
  if(!movie){await camera.enterMovieMode();entered=true;await new Promise(resolve=>setTimeout(resolve,700))}
  await copySettings(camera,before)
  await camera.ensureCanonMovieSoundRecording?.()
  const actual=await snapshot(camera)
  actual.settingsMatched=before.mode===3&&actual.mode===3&&Object.keys(properties).every(key=>before[key as keyof typeof properties]===actual[key as keyof typeof properties])
  return await record(actual)
 }finally{
  // Do not change modes while a failed stop leaves recording uncertain.
  if(entered&&idle()){
   await camera.leaveMovieMode()
   await copySettings(camera,before)
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
 const before=await snapshot(camera)
 const alreadyMovie=(await camera.getCanonUnknownPropertyStates()).some((state:any)=>state.name==='FixedMovie'&&state.rawValue===1)
 let entered=false
 try{
  if(!alreadyMovie){await camera.enterMovieMode();entered=true;await new Promise(resolve=>setTimeout(resolve,700))}
  await copySettings(camera,before)
  await camera.ensureCanonMovieSoundRecording?.()
 }catch(error){if(entered){await camera.leaveMovieMode();await copySettings(camera,before)}throw error}
 return {restore:async()=>{if(entered){await camera.leaveMovieMode();await copySettings(camera,before);entered=false}}}
}
