import {describe,it,expect} from 'vitest'
import {readCameraStorages, readCameraObjectHandles} from '@camera/storage'
function fixture(access:number,flags='notInApplicationMode (Not in application mode)',vendor=0x04b0){return {getInstance:()=>({vendorId:vendor,registry:{operations:{GetStorageIDs:'ids',GetStorageInfo:'info'},properties:{MovieRecProhibitionCondition:'flags'}}}),get:async()=>flags,send:async(op:string)=>({code:0x2001,data:op==='ids'?[0x10000,0x20001]:{accessCapability:access,maxCapacity:256n,freeSpaceInBytes:128n,volumeLabel:'Slot 2'}})}}
describe('camera-side card write capability',()=>{
 it('accepts Nikon host read/delete access when camera protection is clear',async()=>{const cards=await readCameraStorages(fixture(2));expect(cards).toHaveLength(1);expect(cards[0]).toMatchObject({writable:true,hostAccessCapability:2,capacityBytes:256})})
 for(const flag of ['noCardInserted','cardAccessError','cardNotFormatted','noFreeSpace','cardProtected'])it('rejects Nikon '+flag,async()=>{expect((await readCameraStorages(fixture(2,flag)))[0].writable).toBe(false)})
 it('does not generalize Nikon host permissions to other brands',async()=>{expect((await readCameraStorages(fixture(2,'none',0x04a9)))[0].writable).toBe(false)})
 it('fails closed on missing Nikon protection telemetry',async()=>{expect((await readCameraStorages(fixture(2,'')))[0].writable).toBe(false)})
 it('rejects non-deletable read-only cards',async()=>{expect((await readCameraStorages(fixture(1)))[0].writable).toBe(false)})
})

describe('populated card object enumeration',()=>{
 it('never queries empty slots and combines populated slots without duplicate handles',async()=>{
  const calls:number[]=[]
  const camera={getInstance:()=>({registry:{operations:{GetStorageIDs:'ids',GetObjectHandles:'handles'}}}),send:async(op:string,params:any)=>{
   if(op==='ids')return {code:0x2001,data:[0x10000,0x20001,0x30001]}
   calls.push(params.StorageID);return {code:0x2001,data:[7,params.StorageID===0x20001?8:9]}
  }}
  expect([...await readCameraObjectHandles(camera)]).toEqual([7,8,9])
  expect(calls).toEqual([0x20001,0x30001])
 })
 it('does not interpret a rejected object listing as an empty card',async()=>{
  const camera={getInstance:()=>({registry:{operations:{GetStorageIDs:'ids',GetObjectHandles:'handles'}}}),send:async(op:string)=>({code:op==='ids'?0x2001:0x2013,data:op==='ids'?[0x20001]:undefined})}
  await expect(readCameraObjectHandles(camera)).rejects.toThrow('0x2013')
 })
})
