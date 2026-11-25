import type {ShotProperty} from '@workflows/shot-setup'
import {nikonControlLabel} from '@vendors/nikon/control-values'
import {nikonMovieControlProperties,nikonPhotoControlProperties} from '@vendors/control-properties'
import {resolveCameraControl} from '@camera/controls'
import {createPTPRegistry} from '@ptp/registry'
import {getDatatypeByCode} from '@ptp/definitions/datatype-definitions'

export interface ShotSourceProperty {name?:string;value?:unknown;allowedValues?:unknown[];writable?:boolean;enabled?:boolean}

/** Format advertised Nikon PTP values without changing their underlying enum. */
export function normaliseShotControls(source:Record<string,ShotSourceProperty|undefined>,vendor?:string){
 const controls:Record<string,ShotProperty>={},maps=new Map<string,Map<string,string>>()
 const registry=vendor?.toLowerCase()==='nikon'?createPTPRegistry(true):undefined
 const ids=['iso','aperture','shutterSpeed','whiteBalance','focusMode']
 const aliases:Record<string,readonly string[]>=Object.fromEntries(ids.map(key=>{
  const id=resolveCameraControl(key)!,movie=nikonMovieControlProperties[id as keyof typeof nikonMovieControlProperties]??[],photo=nikonPhotoControlProperties[id as keyof typeof nikonPhotoControlProperties]??[]
  return [key,[...new Set([...movie,...photo].map(property=>property.name))]]
 }))
 for(const key of new Set([...Object.keys(source),...Object.keys(aliases)])){
  const name=source[key]?key:aliases[key]?.find(alias=>source[alias]),property=name?source[name]:undefined
  if(!property)continue
  const raw=(value:unknown)=>typeof value==='string'||typeof value==='number'||typeof value==='bigint'?String(value):undefined
  const propertyName=property.name??name!
  const definition=registry?Object.values(registry.properties).find(candidate=>candidate.name===propertyName):undefined
  const datatype=definition?getDatatypeByCode(definition.datatype)?.codec:undefined
  const wire=datatype&&registry?(typeof datatype==='function'?datatype(registry):datatype):undefined
  const codec=definition&&registry?(typeof definition.codec==='function'?definition.codec(registry):definition.codec):undefined
  const label=(value:string)=>{
   if(!registry)return value
   const n=Number(value)
   if(!Number.isFinite(n))return value
   if(wire&&codec)try{return String(codec.decode(wire.encode(n)).value)}catch{return value}
   return nikonControlLabel(propertyName,n)
  }
  const values=[...new Set([...(property.allowedValues||[]).map(raw),raw(property.value)].filter((value):value is string=>value!==undefined))]
  const labels=new Map(values.map(value=>[value,label(value)]))
  const counts=new Map<string,number>();for(const label of labels.values())counts.set(label,(counts.get(label)||0)+1)
  const display=(value:string)=>counts.get(labels.get(value)!)!>1?`${labels.get(value)} (raw ${value})`:labels.get(value)!
  const map=new Map(values.map(value=>[display(value),value]));maps.set(key,map)
  controls[key]={value:raw(property.value)===undefined?undefined:display(raw(property.value)!),allowedValues:property.allowedValues?.map(raw).filter((value):value is string=>value!==undefined).map(display),writable:property.writable,enabled:property.enabled}
 }
 const actionKeys:Record<string,string>={'set-iso':'iso','set-aperture':'aperture','set-shutter-speed':'shutterSpeed','set-white-balance':'whiteBalance'}
 return {controls,rawValue:(key:string,value:string):string|undefined=>maps.get(actionKeys[key]||key)?.get(value)}
}
