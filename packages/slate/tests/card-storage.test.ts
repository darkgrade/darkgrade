import {describe,it,expect,vi} from 'vitest'
import {readCameraStorages, readCameraObjectHandles, waitForNewCameraMovie} from '@vendors/generic/storage'
import {readSonyMovieCard} from '@vendors/sony/card-storage'
function fixture(access:number,flags='notInApplicationMode (Not in application mode)',vendor=0x04b0){return {get driver(){return ({vendorId:vendor,registry:{operations:{GetStorageIDs:'ids',GetStorageInfo:'info'},properties:{MovieRecProhibitionCondition:'flags'}}})},get:async()=>flags,send:async(op:string)=>({code:0x2001,data:op==='ids'?[0x10000,0x20001]:{accessCapability:access,maxCapacity:256n,freeSpaceInBytes:128n,volumeLabel:'Slot 2'}})}}
describe('camera-side card write capability',()=>{
 it('uses native Sony card status while preserving zero-capacity host storage',async()=>{
  const camera=fixture(1,'none',0x054c) as any
  camera.getSonyPropertyStates=async()=>[{code:0xd248,rawValue:1,sonyEnabledFlag:2}]
  Object.defineProperty(camera,'driver',{get:()=>({vendorId:0x054c,registry:{operations:{GetStorageIDs:'ids',GetStorageInfo:'info',GetDeviceInfo:'identity'}}}),configurable:true})
  camera.send=async(op:string)=>({code:0x2001,data:op==='ids'?[0x10001]:op==='identity'?{model:'ILCE-6700'}:{accessCapability:1,maxCapacity:0n,freeSpaceInBytes:0n}})
  expect((await readCameraStorages(camera))[0]).toMatchObject({writable:true,recordingReady:true,hostAccessCapability:1,capacityBytes:0})
  camera.getSonyPropertyStates=async()=>[{code:0xd248,rawValue:2,sonyEnabledFlag:2}]
  expect((await readCameraStorages(camera))[0].writable).toBe(false)
 })
 function sonyBody(identity:()=>Promise<any>){
  const camera=fixture(1,'none',0x054c) as any
  camera.getSonyPropertyStates=async()=>[{code:0xd248,rawValue:1,sonyEnabledFlag:2}]
  Object.defineProperty(camera,'driver',{get:()=>({vendorId:0x054c,registry:{operations:{GetStorageIDs:'ids',GetStorageInfo:'info',GetDeviceInfo:'identity'}}}),configurable:true})
  camera.send=async(op:string)=>op==='identity'?identity():{code:0x2001,data:op==='ids'?[0x10001]:{accessCapability:1,maxCapacity:0n,freeSpaceInBytes:0n}}
  return camera
 }
 it('marks the single-slot fallback verified only on the bench-validated body',async()=>{
  const validated=await readSonyMovieCard(sonyBody(async()=>({code:0x2001,data:{model:'ILCE-6700'}})))
  expect(validated).toMatchObject({status:'ready',slots:[1],singleSlotFallback:true,verified:true})
  const other=sonyBody(async()=>({code:0x2001,data:{model:'ILCE-7M4'}}))
  expect(await readSonyMovieCard(other)).toMatchObject({status:'ready',slots:[1],singleSlotFallback:true,verified:false})
  expect((await readCameraStorages(other))[0]).toMatchObject({writable:true,recordingReady:true,recordingEvidence:{verified:false}})
 })
 it('keeps the native unknown result when the fallback is refused or cannot read the card',async()=>{
  for(const identity of [async()=>({code:0x2019}),async()=>{throw new Error('GetDeviceInfo timed out')}]){
   const camera=sonyBody(identity)
   expect(await readSonyMovieCard(camera)).toMatchObject({status:'unknown',slots:[]})
   expect((await readCameraStorages(camera))[0].writable).toBe(false)
  }
  const unreadable=sonyBody(async()=>({code:0x2001,data:{model:'ILCE-7M4'}}))
  unreadable.getSonyPropertyStates=async()=>[{code:0xd248,rawValue:1,sonyEnabledFlag:0}]
  const card=await readSonyMovieCard(unreadable)
  expect(card).toMatchObject({status:'unknown',slots:[]})
  expect(card).not.toHaveProperty('singleSlotFallback')
 })
 it('does not invent a single-slot Sony destination for an unidentified body',async()=>{
  const camera=fixture(1,'none',0x054c) as any
  camera.getSonyPropertyStates=async()=>[{code:0xd248,rawValue:1,sonyEnabledFlag:2}]
  expect((await readCameraStorages(camera))[0].writable).toBe(false)
 })
 it('does not call a present Sony card recording-ready when its observed movie capacity is zero',async()=>{
  const camera=fixture(1,'none',0x054c) as any
  let seconds=0
  camera.getSonyPropertyStates=async()=>[
   {code:0xd160,rawValue:2,sonyEnabledFlag:1},
   {code:0xd256,rawValue:1,sonyEnabledFlag:2},
   {code:0xd258,rawValue:seconds,sonyEnabledFlag:2},
   {code:0x500e,rawValue:0x78053,value:'Movie Manual',sonyEnabledFlag:1},
  ]
  expect((await readCameraStorages(camera))[0]).toMatchObject({writable:false,recordingReady:false,
   recordingEvidence:{status:'ready',remainingMovieSeconds:0}})
  seconds=120
  expect((await readCameraStorages(camera))[0]).toMatchObject({writable:true,recordingReady:true,
   recordingEvidence:{remainingMovieSeconds:120}})
 })
 it('accepts Nikon host read/delete access when camera protection is clear',async()=>{const cards=await readCameraStorages(fixture(2));expect(cards).toHaveLength(1);expect(cards[0]).toMatchObject({writable:true,hostAccessCapability:2,capacityBytes:256})})
 for(const flag of ['noCardInserted','cardAccessError','cardNotFormatted','noFreeSpace','cardProtected'])it('rejects Nikon '+flag,async()=>{expect((await readCameraStorages(fixture(2,flag)))[0].writable).toBe(false)})
 it('does not generalize Nikon host permissions to other brands',async()=>{expect((await readCameraStorages(fixture(2,'none',0x04a9)))[0].writable).toBe(false)})
 it('fails closed on missing Nikon protection telemetry',async()=>{expect((await readCameraStorages(fixture(2,'')))[0].writable).toBe(false)})
 it('rejects non-deletable read-only cards',async()=>{expect((await readCameraStorages(fixture(1)))[0].writable).toBe(false)})
})

describe('populated card object enumeration',()=>{
 it('preserves the rejected storage operation and camera response code for MCP diagnosis',async()=>{
  const camera={get driver(){return ({registry:{operations:{GetStorageIDs:'ids'}}})},send:async()=>({code:0xa107})}
  await expect(readCameraStorages(camera)).rejects.toThrow('GetStorageIDs: 0xa107')
  await expect(readCameraObjectHandles(camera)).rejects.toThrow('GetStorageIDs: 0xa107')
 })
 it('prepares vendor storage before issuing standard card commands',async()=>{
  const calls:string[]=[]
  const instance={prepareStorageRead:async()=>{calls.push('prepare')},registry:{operations:{GetStorageIDs:'ids'}}}
  const camera={get driver(){return instance},send:async()=>{calls.push('ids');return {code:0x2001,data:[]}}}
  await readCameraStorages(camera);await readCameraObjectHandles(camera)
  expect(calls).toEqual(['prepare','ids','prepare','ids'])
  instance.prepareStorageRead=async()=>{throw new Error('Transfer mode refused')}
  await expect(readCameraObjectHandles(camera)).rejects.toThrow('Transfer mode refused')
  expect(calls).toHaveLength(4)
 })
 it('never queries empty slots and combines populated slots without duplicate handles',async()=>{
  const calls:number[]=[]
  const camera={get driver(){return ({registry:{operations:{GetStorageIDs:'ids',GetObjectHandles:'handles'}}})},send:async(op:string,params:any)=>{
   if(op==='ids')return {code:0x2001,data:[0x10000,0x20001,0x30001]}
   calls.push(params.StorageID);return {code:0x2001,data:[7,params.StorageID===0x20001?8:9]}
  }}
  expect([...await readCameraObjectHandles(camera)]).toEqual([7,8,9])
  expect(calls).toEqual([0x20001,0x30001])
 })
 it('does not interpret a rejected object listing as an empty card',async()=>{
  const camera={get driver(){return ({registry:{operations:{GetStorageIDs:'ids',GetObjectHandles:'handles'}}})},send:async(op:string)=>({code:op==='ids'?0x2001:0x2013,data:op==='ids'?[0x20001]:undefined})}
  await expect(readCameraObjectHandles(camera)).rejects.toThrow('0x2013')
 })
})

describe('card movie finalization',()=>{
 function movieCamera(){let reads=0;return {get driver(){return ({registry:{operations:{GetStorageIDs:'ids',GetObjectHandles:'handles',GetObjectInfo:'info'}}})},send:async(op:string)=>{
  if(op==='ids')return {code:0x2001,data:[0x20001]}
  if(op==='handles')return ++reads===1?{code:0xa107}:{code:0x2001,data:[1,2]}
  return {code:0x2001,data:{filename:'NEW.MP4',objectCompressedSize:12,associationType:0}}
 }}}
 it('waits through a transient card-index rejection and requires a new movie handle',async()=>{
  const result=await waitForNewCameraMovie(movieCamera(),new Set([1]),1000)
  expect(result).toMatchObject({handle:2,filename:'NEW.MP4',objectCompressedSize:12})
 })
 it('never accepts a movie that was present before this recording',async()=>{
  vi.useFakeTimers()
  try{const result=expect(waitForNewCameraMovie(movieCamera(),new Set([1,2]),500)).rejects.toThrow('not finalized');await vi.advanceTimersByTimeAsync(500);await result}
  finally{vi.useRealTimers()}
 })
 it('bounds persistent card-index failures and preserves the actual response code',async()=>{
  vi.useFakeTimers()
  try{const camera=movieCamera();camera.send=async(op:string)=>op==='ids'?{code:0x2001,data:[0x20001]}:{code:0xa107} as any
   const result=expect(waitForNewCameraMovie(camera,new Set(),500)).rejects.toThrow('0xa107');await vi.advanceTimersByTimeAsync(500);await result}
  finally{vi.useRealTimers()}
 })
})
