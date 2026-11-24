import {it,expect} from 'vitest'
import {readNikonRecordingStatus} from '@vendors/nikon/recording-status'
it('reads Nikon recording/buffer flags without starting live view, recording or changing settings',async()=>{
 const calls:unknown[]=[]
 const camera={send:async(operation:any,parameters:any)=>{calls.push([operation.name,parameters]);return {code:0x2001,data:{devicePropertyCode:0xd0a4,currentValueRaw:0x4000}}}}
 expect(await readNikonRecordingStatus(camera as any)).toMatchObject({confirmed:true,recording:false,bufferedImages:false,prohibitionBits:0x4000})
 expect(calls).toEqual([['GetDevicePropDescEx',{DevicePropCode:0xd0a4}]])
})
it('recording and pending card writes independently prevent idle confirmation',async()=>{
 for(const flags of [0x400,0x200,0x600]){
  const state=await readNikonRecordingStatus({send:async()=>({code:0x2001,data:{devicePropertyCode:0xd0a4,currentValueRaw:flags}})} as any)
  expect(Boolean(state?.recording||state?.bufferedImages)).toBe(true)
 }
})
it('unsupported, wrong-property and malformed responses stay unknown',async()=>{
 for(const data of [undefined,{devicePropertyCode:0x5001,currentValueRaw:0},{devicePropertyCode:0xd0a4,currentValueRaw:-1},{devicePropertyCode:0xd0a4,currentValueRaw:'0'}])expect(await readNikonRecordingStatus({send:async()=>({code:0x2001,data})} as any)).toBeUndefined()
 expect(await readNikonRecordingStatus({send:async()=>{throw new Error('Not supported')}} as any)).toBeUndefined()
})
