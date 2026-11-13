import {it,expect,vi} from 'vitest'
import {SonyPtpVideoRecording} from '@vendors/sony/ptp-video-recording'
function fixture(){
 let state=0,handles=[1],bytes=3,name='new.MP4'
 const operations=Object.fromEntries(['GetStorageIDs','GetObjectHandles','GetObjectInfo','SDIO_GetPartialLargeObject'].map(name=>[name,{name}]))
 const send=vi.fn(async(op:any,args:any)=>{
  if(op.name==='GetStorageIDs')return {code:0x2001,data:[0x10001]}
  if(op.name==='GetObjectHandles')return {code:0x2001,data:handles}
  if(op.name==='GetObjectInfo')return {code:0x2001,data:{filename:args.ObjectHandle===1?'old.MP4':name,objectCompressedSize:bytes}}
  return {code:0x2001,data:new Uint8Array(Math.min(args.MaxBytes,bytes))}
 })
 const camera={getInstance:()=>({registry:{operations},prepareStorageRead:async()=>{}}),send,
  getSonyPropertyStates:async()=>[{code:0xd21d,rawValue:state}],
  startRecording:vi.fn(async()=>{state=1}),
  stopRecording:vi.fn(async()=>{state=0;handles=[1,2]})}
 return {camera,recording:new SonyPtpVideoRecording(camera),setState:(s:number)=>state=s,setBytes:(n:number)=>bytes=n,setName:(n:string)=>name=n,setHandles:(value:number[])=>handles=value}
}
it('native take confirms state, discovers only the new original and streams verified bytes',async()=>{
 const f=fixture();await f.recording.prepare();expect(await f.recording.start()).toMatchObject({recordingConfirmed:true})
 const result=await f.recording.stop();expect(result.media).toEqual([{id:'2',filename:'new.MP4',bytes:3,verified:true}])
 const chunks:number[]=[],progress=vi.fn()
 await f.recording.transfer(result.media[0],async bytes=>{chunks.push(bytes.length)},progress)
 expect(chunks).toEqual([3]);expect(progress).toHaveBeenLastCalledWith(3,3)
 expect(f.camera.send.mock.calls.some(([op])=>op.name==='SDIO_GetPartialLargeObject')).toBe(true)
})
it('a command acknowledgement without observed recording fails and cleanup still sends Stop',async()=>{
 vi.useFakeTimers()
 try{
  const f=fixture();f.camera.startRecording.mockImplementation(async()=>{})
  await f.recording.prepare()
  const pending=expect(f.recording.start()).rejects.toThrow('did not confirm')
  await vi.advanceTimersByTimeAsync(6000);await pending
  await f.recording.cleanup();expect(f.camera.stopRecording).toHaveBeenCalled()
 }finally{vi.useRealTimers()}
})
it('transfers reject active recording, changed identity and empty chunks',async()=>{
 const f=fixture(),file={id:'2',filename:'new.MP4',bytes:3,verified:true},write=vi.fn()
 f.setHandles([1,2])
 f.setState(1);await expect(f.recording.transfer(file,write,()=>{})).rejects.toThrow('Stop Sony')
 f.setState(0);f.setName('other.MP4');await expect(f.recording.transfer(file,write,()=>{})).rejects.toThrow('identity changed')
 f.setName('new.MP4');const original=f.camera.send.getMockImplementation()!
 f.camera.send.mockImplementation(async(op,args)=>op.name==='SDIO_GetPartialLargeObject'?{code:0x2001,data:new Uint8Array()}:original(op,args))
 await expect(f.recording.transfer(file,write,()=>{})).rejects.toThrow('incomplete')
 expect(write).not.toHaveBeenCalled()
})
it('a resumed transfer rebuilds the card index and refuses stale handles before requesting object metadata',async()=>{
 const f=fixture(),write=vi.fn(),file={id:'2',filename:'new.MP4',bytes:3,verified:true}
 await expect(f.recording.transfer(file,write,()=>{})).rejects.toThrow('current card index')
 expect(f.camera.send.mock.calls.some(([op])=>op.name==='GetObjectInfo')).toBe(false)
 f.setHandles([1,2]);await f.recording.transfer(file,write,()=>{})
 expect(write).toHaveBeenCalledOnce()
})
it('native recovery retains exact handles but never treats SDK content IDs as PTP handles',async()=>{
 const f=fixture();await f.recording.prepare();await f.recording.start()
 const resumed=new SonyPtpVideoRecording(f.camera)
 expect((await resumed.stopInterrupted(f.recording.getRecoveryState())).media).toHaveLength(1)
 const legacy=await new SonyPtpVideoRecording(f.camera).stopInterrupted({version:1,kind:'sony',baseline:['old.MP4']})
 expect(legacy.stopped).toBe(true);expect(legacy.media).toEqual([])
})
