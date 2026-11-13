import {it,expect,vi} from 'vitest'
import {SonyPtpVideoRecording} from '@vendors/sony/ptp-video-recording'
function fixture(){
 let state:unknown=0,handles=[1],bytes=3,name='new.MP4'
 const largeChunk=new Uint8Array(2*1024*1024)
 const operations=Object.fromEntries(['GetStorageIDs','GetObjectHandles','GetObjectInfo','SDIO_GetPartialLargeObject','GetDeviceInfo','MtpGetObjectPropDesc','MtpGetObjectPropValue'].map(name=>[name,{name}]))
 const send=vi.fn(async(op:any,args:any)=>{
  if(op.name==='GetStorageIDs')return {code:0x2001,data:[0x10001]}
  if(op.name==='GetObjectHandles')return {code:0x2001,data:handles}
  if(op.name==='GetObjectInfo')return {code:0x2001,data:{filename:args.ObjectHandle===1?'old.MP4':name,objectCompressedSize:bytes}}
  return {code:0x2001,data:largeChunk.subarray(0,Math.min(args.MaxBytes,bytes))}
 })
 const camera={getInstance:()=>({registry:{operations},prepareStorageRead:async()=>{}}),send,
  getSonyPropertyStates:async()=>[{code:0xd21d,rawValue:state}],
  startRecording:vi.fn(async()=>{state=1}),
  stopRecording:vi.fn(async()=>{state=0;handles=[1,2]})}
 return {camera,recording:new SonyPtpVideoRecording(camera),setState:(s:unknown)=>state=s,setBytes:(n:number)=>bytes=n,setName:(n:string)=>name=n,setHandles:(value:number[])=>handles=value}
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
it('missing numeric movie state and an unprepared baseline never authorize Record',async()=>{
 const f=fixture()
 await expect(f.recording.start()).rejects.toThrow('Prepare')
 for(const value of [null,undefined,false,'',NaN,4]){
  f.setState(value);await expect(f.recording.prepare()).rejects.toThrow('valid native movie state')
 }
 expect(f.camera.startRecording).not.toHaveBeenCalled()
 f.setState(0);await f.recording.prepare();await f.recording.start()
 await expect(f.recording.prepare()).rejects.toThrow('Stop the current')
 await expect(f.recording.start()).rejects.toThrow('Prepare')
 const stopped=await f.recording.stop()
 expect(await f.recording.stop()).toEqual(stopped)
 expect(f.camera.stopRecording).toHaveBeenCalledOnce()
})
it('a new directory does not hide the movie that follows it in the card index',async()=>{
 const f=fixture(),original=f.camera.send.getMockImplementation()!
 f.camera.send.mockImplementation(async(op,args)=>op.name==='GetObjectInfo'&&args.ObjectHandle===2
  ?{code:0x2001,data:{filename:'CLIP',objectCompressedSize:0,associationType:1,objectFormat:0x3001}}
  :original(op,args))
 f.camera.stopRecording.mockImplementation(async()=>{f.setState(0);f.setHandles([1,2,3])})
 await f.recording.prepare();await f.recording.start()
 expect((await f.recording.stop()).media).toEqual([{id:'3',filename:'new.MP4',bytes:3,verified:true}])
})
it('an exact-handle MTP UINT64 size transfers across the 4 GiB offset boundary without buffering the movie',async()=>{
 const f=fixture(),original=f.camera.send.getMockImplementation()!,size=0x100000000+5
 f.setBytes(0xffffffff);f.setHandles([1,2])
 const descriptor=new Uint8Array(18),descriptorView=new DataView(descriptor.buffer)
 descriptorView.setUint16(0,0xdc04,true);descriptorView.setUint16(2,8,true)
 const sizeData=new Uint8Array(8);new DataView(sizeData.buffer).setBigUint64(0,BigInt(size),true)
 f.camera.send.mockImplementation(async(op,args)=>{
  if(op.name==='GetDeviceInfo')return {code:0x2001,data:{operationsSupported:[0x9802,0x9803]}}
  if(op.name==='MtpGetObjectPropDesc')return {code:0x2001,data:descriptor}
  if(op.name==='MtpGetObjectPropValue'){
   expect(args).toEqual({ObjectHandle:2,ObjectPropertyCode:0xdc04})
   return {code:0x2001,data:sizeData}
  }
  return original(op,args)
 })
 let received=0
 await f.recording.transfer({id:'2',filename:'new.MP4',bytes:size,verified:true},async data=>{received+=data.length},()=>{})
 expect(received).toBe(size)
 expect(f.camera.send.mock.calls.filter(([op])=>op.name==='SDIO_GetPartialLargeObject').at(-1)?.[1])
  .toEqual({ObjectHandle:2,OffsetLower:0,OffsetUpper:1,MaxBytes:5})
 descriptorView.setUint16(2,6,true)
 await expect(f.recording.transfer({id:'2',filename:'new.MP4',bytes:size,verified:true},async()=>{},()=>{}))
  .rejects.toThrow('UINT64')
})
