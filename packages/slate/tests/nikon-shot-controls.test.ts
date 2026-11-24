import {it,expect} from 'vitest'
import {NikonShotControls} from '@vendors/nikon/shot-controls'
import {getDatatypeByCode} from '@ptp/definitions/datatype-definitions'
import {createNikonRegistry} from '@ptp/registry'

function fixture(){
 const codes={iso:0xd1aa,aperture:0xd1a9,shutterSpeed:0xd1a8,shutterMode:0x1d074,whiteBalance:0xd23a,focusMode:0xd1fa,autoIso:0xd0ad,exposureProgram:0x500e}
 const descriptors=new Map<number,any>()
 const add=(code:number,type:number,value:number,choices:number[])=>descriptors.set(code,{devicePropertyCode:code,dataType:type,currentValueRaw:value,supportedValuesRaw:choices,formFlag:2,getSet:'GET_SET'})
 add(codes.iso,4,6400,[100,200,400,800,1600,3200,6400]);add(codes.aperture,4,400,[280,400,560]);add(codes.shutterSpeed,6,0x1001e,[0x1001e,0x1003c,0x1007d]);add(codes.shutterMode,2,2,[1,2]);add(codes.whiteBalance,4,2,[2,4,6]);add(codes.focusMode,2,4,[0,1,2,4]);add(codes.autoIso,2,1,[0,1]);add(codes.exposureProgram,4,3,[1,2,3,4])
 let flags=0,video=true,failIso=false,lieIso=false
 const calls:{name:string;code?:number;value?:number}[]=[]
 const instance={sessionId:1,registry:createNikonRegistry(true)}
 const camera={getInstance:()=>instance,get:async()=>video?'VIDEO':'PHOTO',getNikonVendorPropertyCodes:async()=>[...descriptors.keys()],send:async(operation:any,parameters:any,data?:Uint8Array)=>{
  const code=parameters?.DevicePropCode
  calls.push({name:operation.name,code})
  if(operation.name==='ChangeCameraMode')return {code:0x2001}
  if(code===0xd0a4)return {code:0x2001,data:{devicePropertyCode:code,currentValueRaw:flags}}
  const descriptor=descriptors.get(code)
  if(operation.name==='GetDevicePropDescEx')return descriptor?{code:0x2001,data:{...descriptor}}:{code:0x200a}
  if(operation.name==='SetDevicePropValueEx'){
   const datatype=getDatatypeByCode(descriptor.dataType)!,codec=typeof datatype.codec==='function'?datatype.codec(instance.registry as any):datatype.codec
   const value=Number(codec.decode(data!).value);calls.at(-1)!.value=value
   if(code===codes.iso&&failIso)return {code:0x200f}
   if(!(code===codes.iso&&lieIso))descriptor.currentValueRaw=value
   return {code:0x2001}
  }
  throw new Error('Unexpected operation '+operation.name)
 }}
 return {controller:new NikonShotControls(camera as any),descriptors,codes,calls,instance,setFlags:(value:number)=>flags=value,setVideo:(value:boolean)=>video=value,setFailIso:()=>failIso=true,setLieIso:()=>lieIso=true}
}

it('prepares one owned video session and normalises active video properties without a new connection',async()=>{
 const {controller,descriptors,codes,calls}=fixture()
 const result=await controller.prepare()
 expect(result.exposureModeVerified).toBe(true);expect(result.controls.iso).toMatchObject({value:'Auto',writable:true,allowedValues:['ISO 100','ISO 200','ISO 400','ISO 800','ISO 1600','ISO 3200','ISO 6400']})
 expect(result.controls.shutterSpeed).toMatchObject({value:'1/30',writable:true,allowedValues:['1/30','1/60','1/125']})
 expect(result.controls.aperture?.value).toBe('f/4');expect(result.controls.focusMode?.value).toBe('Manual')
 expect(descriptors.get(codes.exposureProgram).currentValueRaw).toBe(1);expect(descriptors.get(codes.shutterMode).currentValueRaw).toBe(1)
 expect(calls.some(call=>/Connect|Session|LiveView/.test(call.name))).toBe(false)
})
it('fixed ISO disables Movie Auto ISO and verifies both values with fresh descriptors',async()=>{
 const {controller,codes,calls}=fixture();await controller.prepare()
 const controls=await controller.apply('set-iso','ISO 400')
 expect(controls.iso?.value).toBe('ISO 400');expect(controls.autoIso?.value).toBe('0')
 expect(calls.filter(call=>call.name==='SetDevicePropValueEx').slice(-2)).toEqual([{name:'SetDevicePropValueEx',code:codes.autoIso,value:0},{name:'SetDevicePropValueEx',code:codes.iso,value:400}])
})
it('rejects unadvertised choices and stale read-only descriptors before writing',async()=>{
 const {controller,calls,descriptors,codes}=fixture();await controller.prepare();const before=calls.filter(call=>call.name==='SetDevicePropValueEx').length
 await expect(controller.apply('set-iso','ISO 123')).rejects.toThrow('advertised')
 descriptors.get(codes.aperture).getSet='GET'
 await expect(controller.apply('set-aperture','f/2.8')).rejects.toThrow('advertised')
 expect(calls.filter(call=>call.name==='SetDevicePropValueEx').length).toBe(before)
})
it('restores Auto ISO after camera rejection or false successful ISO readback',async()=>{
 for(const failure of ['reject','lie']){
  const state=fixture();await state.controller.prepare();failure==='reject'?state.setFailIso():state.setLieIso()
  await expect(state.controller.apply('set-iso','ISO 400')).rejects.toThrow(failure==='reject'?'rejected':'readback')
  expect(state.descriptors.get(state.codes.autoIso).currentValueRaw).toBe(1)
 }
})
it('unknown recording status, active card writes and photo mode reject changes',async()=>{
 for(const flags of [0x400,0x200]){
  const state=fixture();state.setFlags(flags)
  await expect(state.controller.prepare()).rejects.toThrow('idle')
  expect(state.calls.some(call=>call.name==='SetDevicePropValueEx')).toBe(false)
 }
 const state=fixture();state.setVideo(false);await expect(state.controller.prepare()).rejects.toThrow('video mode')
})
it('wrong descriptor identity cannot confirm a setting and an altered session is rejected',async()=>{
 const state=fixture();await state.controller.prepare();state.descriptors.get(state.codes.iso).devicePropertyCode=0x5001
 await expect(state.controller.read()).rejects.toThrow('descriptor')
 state.instance.sessionId=2;await expect(state.controller.read()).rejects.toThrow('session changed')
})
it('shutter, aperture and focus apply exact advertised vendor datatypes and readback',async()=>{
 const {controller}=fixture();await controller.prepare()
 expect((await controller.apply('set-shutter-speed','1/60')).shutterSpeed?.value).toBe('1/60')
 expect((await controller.apply('set-aperture','f/2.8')).aperture?.value).toBe('f/2.8')
 expect((await controller.apply('set-focus-mode','AF-S')).focusMode?.value).toBe('AF-S')
})
it('requires current Manual exposure before fixed ISO and retains the active automatic gain otherwise',async()=>{
 const state=fixture();await state.controller.prepare();state.descriptors.get(state.codes.exposureProgram).currentValueRaw=3
 expect((await state.controller.read()).iso).toMatchObject({value:'Auto',writable:false})
 await expect(state.controller.apply('set-iso','ISO 400')).rejects.toThrow('advertised')
})

it('generic setters accept raw advertised numeric values alongside optimiser labels',async()=>{
 const {controller}=fixture();await controller.prepare()
 expect((await controller.apply('set-iso','400')).iso?.value).toBe('ISO 400')
 expect((await controller.apply('set-shutter-speed','65596')).shutterSpeed?.value).toBe('1/60')
 expect((await controller.apply('set-focus-mode','0')).focusMode?.value).toBe('AF-S')
 await expect(controller.apply('set-iso','400.0')).rejects.toThrow('advertised')
 await expect(controller.apply('set-iso','9007199254740993')).rejects.toThrow('advertised')
})
it('a property removed from fresh vendor discovery cannot retain cached writable controls',async()=>{
 const state=fixture();await state.controller.prepare();state.descriptors.delete(state.codes.aperture)
 expect((await state.controller.read()).aperture).toBeUndefined()
 await expect(state.controller.apply('set-aperture','f/2.8')).rejects.toThrow('advertised')
})
