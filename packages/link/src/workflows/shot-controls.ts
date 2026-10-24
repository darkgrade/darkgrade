import type {ShotProperty} from '@workflows/shot-setup'

export interface ShotSourceProperty {name?:string;value?:unknown;allowedValues?:unknown[];writable?:boolean;enabled?:boolean}

/** Format advertised Nikon PTP values without changing their underlying enum. */
export function normaliseShotControls(source:Record<string,ShotSourceProperty|undefined>,vendor?:string){
 const controls:Record<string,ShotProperty>={},maps=new Map<string,Map<string,string>>()
 const aliases:Record<string,string[]>={iso:['ExposureIndex','NikonMovieISO'],aperture:['FNumber','NikonMovieFNumber'],shutterSpeed:['NikonMovieShutterSpeed','ExposureTime'],whiteBalance:['NikonMovieWhiteBalance','WhiteBalance'],focusMode:['NikonMovieFocusMode','NikonStillFocusMode','FocusMode']}
 for(const key of new Set([...Object.keys(source),...Object.keys(aliases)])){
  const name=source[key]?key:aliases[key]?.find(alias=>source[alias]),property=name?source[name]:undefined
  if(!property)continue
  const raw=(value:unknown)=>typeof value==='string'||typeof value==='number'||typeof value==='bigint'?String(value):undefined
  const label=(value:string)=>{
   if(vendor?.toLowerCase()!=='nikon')return value
   const n=Number(value)
   if(key==='iso'&&Number.isFinite(n)&&n>0)return `ISO ${n}`
   if(key==='aperture'&&Number.isFinite(n)&&n>0)return `f/${Number((n/100).toFixed(3))}`
   if(key==='shutterSpeed'&&Number.isFinite(n)&&n>0){
    // libgphoto2 _get_Nikon_ShutterSpeed: movie/vendor shutter packs a
    // numerator in the upper16 bits and a denominator in the lower16.
    // Standard PTP ExposureTime is a different property, in 1/10000 seconds.
    if(property.name==='NikonMovieShutterSpeed'||name==='NikonMovieShutterSpeed'){
     if(n===0xffffffff)return 'Bulb'
     if(n===0xfffffffd)return 'Time'
     if(n===0xfffffffe)return 'Flash sync'
     if(!Number.isInteger(n)||n>0xffffffff)return `Unknown shutter (${value})`
     const numerator=n>>>16,denominator=n&0xffff
     if(!numerator||!denominator)return `Unknown shutter (${value})`
     return numerator===1&&denominator>1?`1/${denominator}`:`${Number((numerator/denominator).toFixed(6))}s`
    }
    return n<10000?`1/${Math.round(10000/n)}`:`${Number((n/10000).toFixed(4))}s`
   }
   // Primary table: gphoto/libgphoto2 camlibs/ptp2/config.c whitebalance[].
   // MovieWhiteBalance uses this same table, not an unrelated Nikon enum.
   if(key==='whiteBalance')return ({1:'Manual',2:'Auto',3:'One-push auto',4:'Daylight',5:'Fluorescent',6:'Tungsten',7:'Flash',32784:'Cloudy',32785:'Shade',32786:'Color Temperature',32787:'Preset',32788:'Off',32789:'Flash',32790:'Natural light auto'} as Record<number,string>)[n]||(Number.isFinite(n)?`Unknown white balance (${value})`:value)
   if(key==='focusMode'){const labels:Record<number,string>=property.name==='FocusMode'||name==='FocusMode'?{1:'Manual',2:'Auto',3:'Auto macro'}:{0:'AF-S',1:'AF-C',2:'AF-F',4:'Manual'};return labels[n]||value}
   return value
  }
  const values=[...new Set([...(property.allowedValues||[]).map(raw),raw(property.value)].filter((value):value is string=>value!==undefined))]
  const counts=new Map<string,number>();for(const value of values)counts.set(label(value),(counts.get(label(value))||0)+1)
  const display=(value:string)=>counts.get(label(value))!>1?`${label(value)} (raw ${value})`:label(value)
  const map=new Map(values.map(value=>[display(value),value]));maps.set(key,map)
  controls[key]={value:raw(property.value)===undefined?undefined:display(raw(property.value)!),allowedValues:property.allowedValues?.map(raw).filter((value):value is string=>value!==undefined).map(display),writable:property.writable,enabled:property.enabled}
 }
 const actionKeys:Record<string,string>={'set-iso':'iso','set-aperture':'aperture','set-shutter-speed':'shutterSpeed','set-white-balance':'whiteBalance'}
 return {controls,rawValue:(key:string,value:string):string|undefined=>maps.get(actionKeys[key]||key)?.get(value)}
}
