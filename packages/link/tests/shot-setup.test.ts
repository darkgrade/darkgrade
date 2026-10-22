import {it,expect} from 'vitest'
import {describeShot} from '@workflows/shot-analysis'
import {optimiseShot} from '@workflows/shot-setup'
import type {ShotAnalysis} from '@workflows/shot-analysis'
const balanced:ShotAnalysis={metrics:{median:.4,p95:.7,clipped:0,dark:0,detail:.003,neutralPixels:.2,redBlueRatio:1},exposure:'balanced',focus:'detail-visible',colour:'neutral',method:'fixture',durationMilliseconds:1}
it('does not overshoot a measured bright ISO even when a higher ISO has never been tried',async()=>{
 let state={iso:{value:'2000',allowedValues:['500','1000','1250','1600','2000','4000'],writable:true},shutterSpeed:{value:'1/50'},focusMode:{value:'AF-S'}};let samples=0
 const report=await optimiseShot({image:new Uint8Array(),controls:state,focusRequested:true,focus:async()=>({focusAcquired:true}),publish:()=>{},analyse:async()=>{samples++;if(samples===1)return balanced;if(state.iso.value==='2000')return {...balanced,exposure:'bright',metrics:{...balanced.metrics,clipped:.04}};if(Number(state.iso.value)<=1000)return {...balanced,exposure:'dark',metrics:{...balanced.metrics,median:.02,dark:.7}};return balanced},apply:async(_action,value)=>{state={...state,iso:{...state.iso,value}};return state},recapture:async()=>new Uint8Array()})
 expect(report.changes.map(change=>change.after).slice(0,2)).toEqual(['500','1000'])
 expect(Number(state.iso.value)).toBeGreaterThan(1000);expect(Number(state.iso.value)).toBeLessThan(2000);expect(report.exposureVerified).toBe(true)
})

it('rechecks a drastically changed scene instead of certifying its initial balanced frame',async()=>{
 let samples=0
 const result=await optimiseShot({image:new Uint8Array(),controls:{iso:{value:'400'},shutterSpeed:{value:'1/50'},focusMode:{value:'AF-S'}},focusRequested:true,focus:async()=>({focusAcquired:true}),publish:()=>{},analyse:async()=>++samples===1?balanced:{...balanced,exposure:'bright',metrics:{...balanced.metrics,median:.95,clipped:.7}},apply:async()=>{throw new Error('No writable controls')},recapture:async()=>new Uint8Array()})
 expect(result.before?.exposure).toBe('balanced');expect(result.analysis?.exposure).toBe('bright');expect(result.exposureVerified).toBe(false);expect(result.status).toBe('attention')
})

it('bounds corrections when illumination alternates and preserves white balance',async()=>{
 let samples=0,writes=0
 const controls={iso:{value:'400',allowedValues:['100','200','400','800','1600','3200','6400','12800'],writable:true},shutterSpeed:{value:'1/50'},whiteBalance:{value:'Daylight',allowedValues:['Daylight','Auto'],writable:true}}
 const result=await optimiseShot({image:new Uint8Array(),controls,publish:()=>{},analyse:async()=>++samples%2?{...balanced,exposure:'dark',metrics:{...balanced.metrics,median:.02,dark:.8}}:{...balanced,exposure:'bright',metrics:{...balanced.metrics,median:.95,clipped:.8}},apply:async(action,value)=>{expect(action).toBe('set-iso');writes++;controls.iso.value=value;return controls},recapture:async()=>new Uint8Array()})
 expect(writes).toBeGreaterThan(0);expect(writes).toBeLessThanOrEqual(4);expect(result.exposureVerified).toBe(false);expect(result.status).toBe('attention');expect(controls.whiteBalance.value).toBe('Daylight')
})

it('does not claim a good shot after settings change but the fresh preview fails',async()=>{
 const controls={iso:{value:'400',allowedValues:['400','1600'],writable:true},shutterSpeed:{value:'1/50'}}
 const result=await optimiseShot({image:new Uint8Array(),controls,publish:()=>{},analyse:async()=>({...balanced,exposure:'dark',metrics:{...balanced.metrics,median:.02,dark:.8}}),apply:async(_action,value)=>{controls.iso.value=value;return controls},recapture:async()=>{throw new Error('Preview disconnected')}})
 expect(result.imageVerified).toBe(false);expect(result.exposureVerified).toBe(false);expect(result.status).toBe('attention');expect(result.error).toContain('Preview disconnected')
})

// Physical EOS 80D ISO 100 HDMI sample: dim midtones without crushed blacks.
it('recognises an underexposed scene without requiring black pixels',()=>{
 expect(describeShot({...balanced.metrics,median:.0667,p95:.126,dark:.0074}).exposure).toBe('dark')
 expect(describeShot({...balanced.metrics,median:.0667,p95:.9,dark:.0074}).exposure).toBe('balanced')
})

it('uses advertised video cadence and fixed ISO together without changing the colour preset',async()=>{
 const controls={iso:{value:'Auto',allowedValues:['Auto','100','400','1600'],writable:true},shutterSpeed:{value:'1/1000',allowedValues:['1/50','1/100','1/1000'],writable:true},whiteBalance:{value:'Daylight',allowedValues:['Daylight','Auto'],writable:true}}
 const writes:string[]=[]
 const result=await optimiseShot({image:new Uint8Array(),controls,frameRate:25,publish:()=>{},analyse:async()=>balanced,apply:async(action,value)=>{writes.push(action);if(action==='set-iso')controls.iso.value=value;if(action==='set-shutter-speed')controls.shutterSpeed.value=value;return controls},recapture:async()=>new Uint8Array()})
 expect(writes).toEqual(['set-shutter-speed','set-iso']);expect(controls.shutterSpeed.value).toBe('1/50');expect(controls.iso.value).toBe('400');expect(controls.whiteBalance.value).toBe('Daylight');expect(result.exposureVerified).toBe(true)
})
