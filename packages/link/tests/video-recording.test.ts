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
