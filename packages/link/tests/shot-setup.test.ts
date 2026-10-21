import {it,expect} from 'vitest'
import {optimiseShot} from '@workflows/shot-setup'
import type {ShotAnalysis} from '@workflows/shot-analysis'
const balanced:ShotAnalysis={metrics:{median:.4,p95:.7,clipped:0,dark:0,detail:.003,neutralPixels:.2,redBlueRatio:1},exposure:'balanced',focus:'detail-visible',colour:'neutral',method:'fixture',durationMilliseconds:1}
it('does not overshoot a measured bright ISO even when a higher ISO has never been tried',async()=>{
 let state={iso:{value:'2000',allowedValues:['500','1000','1250','1600','2000','4000'],writable:true},shutterSpeed:{value:'1/50'},focusMode:{value:'AF-S'}};let samples=0
 const report=await optimiseShot({image:new Uint8Array(),controls:state,focusRequested:true,focus:async()=>({focusAcquired:true}),publish:()=>{},analyse:async()=>{samples++;if(samples===1)return balanced;if(state.iso.value==='2000')return {...balanced,exposure:'bright',metrics:{...balanced.metrics,clipped:.04}};if(Number(state.iso.value)<=1000)return {...balanced,exposure:'dark',metrics:{...balanced.metrics,median:.02,dark:.7}};return balanced},apply:async(_action,value)=>{state={...state,iso:{...state.iso,value}};return state},recapture:async()=>new Uint8Array()})
 expect(report.changes.map(change=>change.after).slice(0,2)).toEqual(['500','1000'])
 expect(Number(state.iso.value)).toBeGreaterThan(1000);expect(Number(state.iso.value)).toBeLessThan(2000);expect(report.exposureVerified).toBe(true)
})
