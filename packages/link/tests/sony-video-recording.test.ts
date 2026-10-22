import {it,expect,vi} from 'vitest'
import {SonyVideoRecording} from '@vendors/sony/video-recording'
// The new clip sorts below twenty older files if the camera clock changed.
it('verifies a new movie outside the recent-file window using the complete baseline',async()=>{
 let recorded=false
 const old=Array.from({length:25},(_,id)=>({id:id+1,files:[{id:5,name:`old-${id}.MP4`,bytes:100}]}))
 const getRecentSonyContents=vi.fn(async(options:any)=>options?.all?[...old,...(recorded?[{id:26,files:[{id:5,name:'new.MP4',bytes:200}]}]:[])]:old.slice(0,20))
 const camera:any={getSonyProperty:async(name:string)=>({value:name==='RecordingState'?recorded?'1':'0':'1'}),getRecentSonyContents,startRecording:async()=>{recorded=true},stopRecording:async()=>{recorded=false;old.push({id:26,files:[{id:5,name:'new.MP4',bytes:200}]})},getSonyProperties:async()=>[]}
 const recording=new SonyVideoRecording(camera)
 // Card readiness is independent of this content-index contract.
 ;(recording as any).baseline=new Set(old.flatMap(content=>content.files.map(file=>JSON.stringify([file.name,String(file.bytes)]))))
 ;(recording as any).attempted=true
 const stopped=await recording.stop()
 expect(stopped.media).toEqual([{id:'26:5',filename:'new.MP4',bytes:200,verified:true}])
 expect(getRecentSonyContents).toHaveBeenCalledWith({all:true})
})

it('waits for asynchronous idle confirmation when recovering an interrupted Sony recorder',async()=>{
 vi.useFakeTimers()
 try{
  let samples=0
  const camera={stopRecording:vi.fn(async()=>{}),getSonyProperty:vi.fn(async()=>({value:++samples<4?'1':'0'}))}
  const result=new SonyVideoRecording(camera).stopInterrupted()
  await vi.advanceTimersByTimeAsync(1000)
  await expect(result).resolves.toMatchObject({stopped:true,media:[]})
  expect(camera.getSonyProperty).toHaveBeenCalledTimes(4)
 }finally{vi.useRealTimers()}
})

it('renews a stale SDK content session only after idle and preserves the recording baseline',async()=>{
 vi.useFakeTimers()
 try{
  const old={id:1,files:[{id:5,name:'old.MP4',bytes:100}]},fresh={id:2,files:[{id:5,name:'new.MP4',bytes:200}]}
  let idle=false
  const camera={stopRecording:async()=>{idle=true},getSonyProperty:async()=>({value:idle?'0':'1'}),getRecentSonyContents:async()=>[old]}
  const renew=vi.fn(async()=>{expect(idle).toBe(true);return {getRecentSonyContents:async()=>[old,fresh]}})
  const recording=new SonyVideoRecording(camera,renew);(recording as any).attempted=true;(recording as any).baseline=new Set([JSON.stringify(['old.MP4','100'])])
  const pending=recording.stop();await vi.advanceTimersByTimeAsync(16000)
  expect((await pending).media).toEqual([{id:'2:5',filename:'new.MP4',bytes:200,verified:true}]);expect(renew).toHaveBeenCalledTimes(1)
 }finally{vi.useRealTimers()}
})

it('does not turn a failed post-stop index refresh into unconfirmed recording',async()=>{
 vi.useFakeTimers()
 try{
  const camera={stopRecording:async()=>{},getSonyProperty:async()=>({value:'0'}),getRecentSonyContents:async()=>[]}
  const recording=new SonyVideoRecording(camera,async()=>{throw new Error('SDK session unavailable')});(recording as any).attempted=true
  const pending=recording.stop();await vi.advanceTimersByTimeAsync(16000)
  await expect(pending).resolves.toMatchObject({stopped:true,media:[],warning:expect.stringContaining('refreshing its SDK content index failed')})
 }finally{vi.useRealTimers()}
})
