import {it,expect,vi} from 'vitest'
import {SonyVideoRecording} from '@vendors/sony/video-recording'
it('refreshes a known stale post-stop snapshot without waiting fifteen seconds',async()=>{
 vi.useFakeTimers();try{
  const old={id:1,files:[{id:5,name:'old.MP4',bytes:100}]},fresh={id:2,files:[{id:5,name:'new.MP4',bytes:200}]}
  const camera={stopRecording:async()=>{},getSonyProperty:async()=>({value:'0'}),getRecentSonyContents:async()=>[old],shouldRefreshMediaIndex:()=>true}
  const renew=vi.fn(async()=>({getRecentSonyContents:async()=>[old,fresh]})),recording=new SonyVideoRecording(camera,renew)
  ;(recording as any).attempted=true;(recording as any).baseline=new Set([JSON.stringify(['old.MP4','100'])])
  const pending=recording.stop();await vi.advanceTimersByTimeAsync(500)
  expect((await pending).media[0].filename).toBe('new.MP4');expect(renew).toHaveBeenCalledTimes(1)
 }finally{vi.useRealTimers()}
})
it('does not arm a take that would land on the SDK pagination boundary',async()=>{
 const camera={getSonyProperty:async(name:string)=>({value:name==='RecordingState'||name.endsWith('_Status')?'0':name==='Movie_RecordingMedia'?'1':'3600'}),getRecentSonyContents:async()=>Array.from({length:99},(_,id)=>({id,files:[]})),startRecording:vi.fn()}
 await expect(new SonyVideoRecording(camera).prepare()).rejects.toThrow('Run recording checks')
 expect(camera.startRecording).not.toHaveBeenCalled()
})
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

it('recovers an invalid held SDK session with an idempotent Stop and no new recording',async()=>{
 vi.useFakeTimers()
 try{
  const camera={stopRecording:async()=>{throw new Error('Sony SDK command failed (SDK code 33794)')}}
  const stop=vi.fn(async()=>{}),restart=vi.fn(async()=>({stopRecording:stop,getSonyProperty:async()=>({value:'0'})}))
  const pending=new SonyVideoRecording(camera,restart).stopInterrupted();await vi.advanceTimersByTimeAsync(500)
  await expect(pending).resolves.toMatchObject({stopped:true});expect(restart).toHaveBeenCalledTimes(1);expect(stop).toHaveBeenCalledTimes(1)
 }finally{vi.useRealTimers()}
})

it('retains exact movie identity after restoring a persisted recording baseline',async()=>{
 vi.useFakeTimers()
 try{
  const recovery={version:1,kind:'sony',baseline:[JSON.stringify(['old.MP4','100'])]}
  const camera={stopRecording:async()=>{},getSonyProperty:async()=>({value:'0'}),getRecentSonyContents:async()=>[{id:1,files:[{id:5,name:'old.MP4',bytes:100}]},{id:2,files:[{id:5,name:'new.MP4',bytes:200}]}]}
  const pending=new SonyVideoRecording(camera).stopInterrupted(recovery);await vi.advanceTimersByTimeAsync(500)
  expect((await pending).media).toEqual([{id:'2:5',filename:'new.MP4',bytes:200,verified:true}])
 }finally{vi.useRealTimers()}
})
it('invalid recovery metadata confirms Stop without claiming any preexisting movie',async()=>{
 vi.useFakeTimers()
 try{
  const camera={stopRecording:async()=>{},getSonyProperty:async()=>({value:'0'}),getRecentSonyContents:vi.fn()}
  const pending=new SonyVideoRecording(camera).stopInterrupted({version:1,kind:'sony',baseline:[{}]});await vi.advanceTimersByTimeAsync(500)
  expect((await pending).media).toEqual([]);expect(camera.getRecentSonyContents).not.toHaveBeenCalled()
 }finally{vi.useRealTimers()}
})

it('requires a fresh idle state before indexing and transferring a stopped original',async()=>{
 const calls:string[]=[],camera={getSonyProperty:async(name:string)=>{calls.push(name);return {value:'0'}},getRecentSonyContents:async()=>{calls.push('index');return [{id:2,files:[{id:5,name:'new.MP4',bytes:200}]}]},downloadSonyContent:async()=>{calls.push('transfer');return {path:'new.MP4'}}}
 await new SonyVideoRecording(camera).transfer({id:'2:5',filename:'new.MP4',bytes:200,verified:true},'/tmp','new.MP4')
 expect(calls).toEqual(['RecordingState','index','transfer'])
})
it('does not index or transfer when the camera no longer confirms idle',async()=>{
 const camera={getSonyProperty:async()=>({value:'1'}),getRecentSonyContents:vi.fn(),downloadSonyContent:vi.fn()}
 await expect(new SonyVideoRecording(camera).transfer({id:'2:5',filename:'new.MP4',bytes:200,verified:true},'/tmp','new.MP4')).rejects.toThrow('Stop recording')
 expect(camera.getRecentSonyContents).not.toHaveBeenCalled();expect(camera.downloadSonyContent).not.toHaveBeenCalled()
})
