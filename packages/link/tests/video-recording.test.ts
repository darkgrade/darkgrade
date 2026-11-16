import {describe,it,expect} from 'vitest'
import {UsbVideoRecording} from '@camera/video-recording'
function fixture(){
 const calls:{operation:string;args:any}[]=[],operations=Object.fromEntries(['GetStorageIDs','GetStorageInfo','GetObjectHandles','GetObjectInfo','GetPartialObjectEx'].map(name=>[name,name]));let recorded=false
 const camera={getInstance:()=>({vendorId:0x04b0,registry:{operations,properties:{MovieRecProhibitionCondition:'flags'}}}),get:async()=> 'notInApplicationMode',send:async(operation:string,args:any)=>{
  calls.push({operation,args})
  if(operation==='GetStorageIDs')return {code:0x2001,data:[0x10000,0x20001]}
  if(operation==='GetStorageInfo')return {code:0x2001,data:{accessCapability:2,maxCapacity:1000n,freeSpaceInBytes:500n}}
  if(operation==='GetObjectHandles'){if(args.StorageID===0x10000)return {code:0x2013};return {code:0x2001,data:recorded?[1,2]:[1]}}
  if(operation==='GetObjectInfo')return {code:0x2001,data:{filename:'CLIP.MOV',objectCompressedSize:12}}
  return {code:0x2001,data:new Uint8Array(12)}
 },startRecording:async()=>{recorded=true},stopRecording:async()=>{}}
 return {camera,calls,recording:new UsbVideoRecording(camera,'nikon')}
}
describe('USB card movie reliability',()=>{
 it('ignores the empty slot and accepts Nikon host read/delete access',async()=>{const f=fixture();await f.recording.prepare();expect(f.calls.filter(call=>call.operation==='GetObjectHandles').map(call=>call.args.StorageID)).toEqual([0x20001])})
 it('never promotes an acknowledged Nikon start into verified recording telemetry',async()=>{const f=fixture();await f.recording.prepare();expect((await f.recording.start()).recordingConfirmed).toBe(false)})
 it('verifies a new movie after stop and preserves its original identity for transfer',async()=>{const f=fixture();await f.recording.prepare();await f.recording.start();const result=await f.recording.stop();expect(result.stopped).toBe(true);expect(result.media).toEqual([{id:'2',filename:'CLIP.MOV',bytes:12,verified:true}]);const chunks:Uint8Array[]=[];await f.recording.transfer(result.media[0],async bytes=>{chunks.push(bytes)},()=>{});expect(chunks[0].length).toBe(12)})
 it('refuses collection when the file identity changed',async()=>{const f=fixture();await expect(f.recording.transfer({id:'2',filename:'OTHER.MOV',bytes:12,verified:true},async()=>{},()=>{})).rejects.toThrow('Camera file changed')})
 it('rejects actual card protection before opening a recorder',async()=>{const f=fixture();f.camera.get=async()=> 'cardProtected';await expect(f.recording.prepare()).rejects.toThrow('writable memory card')})
 it('does not issue a stop command when recording was never attempted',async()=>{const f=fixture();let stopped=false;f.camera.stopRecording=async()=>{stopped=true};expect(await f.recording.stop()).toEqual({stopped:true,media:[]});expect(stopped).toBe(false)})
})

it('restores the prepared USB baseline after controller loss and excludes old objects',async()=>{
 const f=fixture();await f.recording.prepare();const recovery=f.recording.getRecoveryState();await f.recording.start()
 const recovered=new UsbVideoRecording(f.camera,'nikon'),result=await recovered.stopInterrupted(recovery)
 expect(result.stopped).toBe(true);expect(result.media).toEqual([{id:'2',filename:'CLIP.MOV',bytes:12,verified:true}])
})
it('a missing USB baseline cannot authorize a previous card movie as a new original',async()=>{
 const f=fixture();await f.recording.start();const result=await new UsbVideoRecording(f.camera,'nikon').stopInterrupted()
 expect(result.stopped).toBe(true);expect(result.media).toEqual([]);expect(f.calls.some(call=>call.operation==='GetObjectInfo')).toBe(false)
})

it('confirms Nikon recording only from the fresh movie-status descriptor',async()=>{
 const f=fixture(),send=f.camera.send
 f.camera.send=async(operation:any,args:any)=>operation?.name==='GetDevicePropDescEx'?{code:0x2001,data:{devicePropertyCode:0xd0a4,currentValueRaw:0x400}} as any:send(operation,args)
 const started=await f.recording.start()
 expect(started.recordingConfirmed).toBe(true)
 expect(started.evidence).toBe('Nikon reports active movie recording')
})

it('resolves Nikon 4 GiB sentinel sizes and transfers across the 32-bit offset boundary',async()=>{
 const f=fixture(),send=f.camera.send,total=0x100000000+7,chunk=new Uint8Array(2*1024*1024)
 Object.assign(f.camera.getInstance().registry.operations,{GetObjectSize:'GetObjectSize'})
 const offsets:number[][]=[]
 f.camera.send=async(operation:any,args:any)=>{
  if(operation==='GetObjectInfo')return {code:0x2001,data:{filename:'CLIP.MOV',objectCompressedSize:0xffffffff}} as any
  if(operation==='GetObjectSize')return {code:0x2001,data:BigInt(total)} as any
  if(operation==='GetPartialObjectEx'){offsets.push([args.OffsetUpper,args.OffsetLower]);return {code:0x2001,data:chunk.subarray(0,args.MaxSizeLower)} as any}
  return send(operation,args)
 }
 await f.recording.prepare();await f.recording.start();const stopped=await f.recording.stop()
 expect(stopped.media[0].bytes).toBe(total)
 let written=0
 await f.recording.transfer(stopped.media[0],async bytes=>{written+=bytes.length},()=>{})
 expect(written).toBe(total);expect(offsets.at(-1)).toEqual([1,0])
})
it('refuses a Nikon sentinel when the full size cannot be verified',async()=>{
 const f=fixture(),send=f.camera.send
 f.camera.send=async(operation:any,args:any)=>operation==='GetObjectInfo'?{code:0x2001,data:{filename:'CLIP.MOV',objectCompressedSize:0xffffffff}} as any:send(operation,args)
 await expect(f.recording.transfer({id:'2',filename:'CLIP.MOV',bytes:0xffffffff,verified:true},async()=>{},()=>{})).rejects.toThrow('large-file size')
 Object.assign(f.camera.getInstance().registry.operations,{GetObjectSize:'GetObjectSize'})
 for(const invalid of [0n,BigInt(Number.MAX_SAFE_INTEGER)+1n,'4294967296',undefined]){
  f.camera.send=async(operation:any,args:any)=>operation==='GetObjectSize'?{code:0x2001,data:invalid} as any:operation==='GetObjectInfo'?{code:0x2001,data:{filename:'CLIP.MOV',objectCompressedSize:0xffffffff}} as any:send(operation,args)
  await expect(f.recording.transfer({id:'2',filename:'CLIP.MOV',bytes:0xffffffff,verified:true},async()=>{},()=>{})).rejects.toThrow('64-bit')
 }
})
