import {it,expect,vi} from 'vitest'
import {SonyPtpVideoRecording} from '@vendors/sony/ptp-video-recording'
function fixture(){
 let state:unknown=0,handles=[1],bytes=3,name='new.MP4'
 const restore=vi.fn(async()=>{})
 const largeChunk=new Uint8Array(2*1024*1024)
 const operations=Object.fromEntries(['GetStorageIDs','GetObjectHandles','GetObjectInfo','SDIO_GetPartialLargeObject','GetDeviceInfo','MtpGetObjectPropDesc','MtpGetObjectPropValue','MtpGetObjectPropList'].map(name=>[name,{name}]))
 const send=vi.fn(async(op:any,args:any)=>{
  if(op.name==='GetStorageIDs')return {code:0x2001,data:[0x10001]}
  if(op.name==='GetObjectHandles')return {code:0x2001,data:handles}
  if(op.name==='GetObjectInfo')return {code:0x2001,data:{filename:args.ObjectHandle===1?'old.MP4':name,objectCompressedSize:bytes}}
  return {code:0x2001,data:largeChunk.subarray(0,Math.min(args.MaxBytes,bytes))}
 })
 const camera={get driver(){return ({registry:{operations},prepareStorageRead:async()=>{}})},send,
  prepareRecordingMode:vi.fn(async()=>({restore})),
  getSonyPropertyStates:async()=>[{code:0xd21d,rawValue:state}],
  startRecording:vi.fn(async()=>{state=1}),
  stopRecording:vi.fn(async()=>{state=0;handles=[1,2]})}
 return {camera,restore,recording:new SonyPtpVideoRecording(camera),setState:(s:unknown)=>state=s,setBytes:(n:number)=>bytes=n,setName:(n:string)=>name=n,setHandles:(value:number[])=>handles=value}
}
it('native take confirms state, discovers only the new original and streams verified bytes',async()=>{
 const f=fixture();await f.recording.prepare();expect(await f.recording.start()).toMatchObject({recordingConfirmed:true})
 const result=await f.recording.stop();expect(result.media).toEqual([{id:'2',filename:'new.MP4',bytes:3,verified:true}])
 const chunks:number[]=[],progress=vi.fn()
 await f.recording.transfer(result.media[0],async bytes=>{chunks.push(bytes.length)},progress)
 expect(chunks).toEqual([3]);expect(progress).toHaveBeenLastCalledWith(3,3)
 expect(f.camera.send.mock.calls.some(([op])=>op.name==='SDIO_GetPartialLargeObject')).toBe(true)
})
it('keeps Stop available after an unconfirmed Stop; explicit cleanup sends the next one',async()=>{
 vi.useFakeTimers()
 try{
  const f=fixture();await f.recording.prepare();await f.recording.start()
  f.camera.stopRecording.mockResolvedValueOnce(undefined)
  const failure=expect(f.recording.stop()).rejects.toThrow('preserve camera power')
  await vi.advanceTimersByTimeAsync(15100);await failure
  await f.recording.cleanup()
  expect(f.camera.startRecording).toHaveBeenCalledOnce()
  expect(f.camera.stopRecording).toHaveBeenCalledTimes(2)
 }finally{vi.useRealTimers()}
})
it('leaves movie mode to Camera: indexing failure or a cancelled take never sends Record or a mode write',async()=>{
 const f=fixture()
 f.camera.send.mockRejectedValueOnce(new Error('Card index unavailable'))
 await expect(f.recording.prepare()).rejects.toThrow('Card index unavailable')
 await f.recording.prepare();await f.recording.cleanup()
 expect(f.camera.prepareRecordingMode).not.toHaveBeenCalled()
 expect(f.camera.startRecording).not.toHaveBeenCalled()
 expect(f.camera.stopRecording).not.toHaveBeenCalled()
})
it('accepts a stop whose clip Camera could not find, and looks for the original itself',async()=>{
 const {CameraClipNotFoundError}=await import('@camera/errors')
 const f=fixture();await f.recording.prepare();await f.recording.start()
 f.camera.stopRecording.mockImplementationOnce(async()=>{f.setState(0);f.setHandles([1,2]);throw new CameraClipNotFoundError('stopRecording','no new clip yet')})
 expect((await f.recording.stop()).media).toEqual([{id:'2',filename:'new.MP4',bytes:3,verified:true}])
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
 f.camera.send.mockImplementation((async(op:any,args:any)=>{
  if(op.name==='GetDeviceInfo')return {code:0x2001,data:{operationsSupportedRaw:[0x9802,0x9803],operationsSupportedDecoded:['MtpGetObjectPropDesc','MtpGetObjectPropValue']}}
  if(op.name==='MtpGetObjectPropDesc')return {code:0x2001,data:descriptor}
  if(op.name==='MtpGetObjectPropValue'){
   expect(args).toEqual({ObjectHandle:2,ObjectPropertyCode:0xdc04})
   return {code:0x2001,data:sizeData}
  }
  return original(op,args)
 }) as any)
 let received=0
 await f.recording.transfer({id:'2',filename:'new.MP4',bytes:size,verified:true},async data=>{received+=data.length},()=>{})
 expect(received).toBe(size)
 expect(f.camera.send.mock.calls.filter(([op])=>op.name==='SDIO_GetPartialLargeObject').at(-1)?.[1])
  .toEqual({ObjectHandle:2,OffsetLower:0,OffsetUpper:1,MaxBytes:5})
 descriptorView.setUint16(2,6,true)
 await expect(f.recording.transfer({id:'2',filename:'new.MP4',bytes:size,verified:true},async()=>{},()=>{}))
  .rejects.toThrow('UINT64')
})

it('reads the 64-bit size support from a real DeviceInfo dataset, not from a hand-made field', async () => {
 const { DeviceInfoCodec } = await import('@ptp/datasets/device-info-dataset')
 const { createSonyRegistry } = await import('@vendors/registry')
 const registry = createSonyRegistry(true), dataset = new (DeviceInfoCodec as any)(registry)
 const encoded = dataset.encode({ standardVersion: 100, vendorExtensionID: 0x11, vendorExtensionVersion: 300, vendorExtensionDesc: '', functionalMode: 0,
  operationsSupportedRaw: [0x1001, 0x9802, 0x9803], eventsSupportedRaw: [], devicePropertiesSupported: [], captureFormats: [], imageFormatsRaw: [],
  manufacturer: 'Sony Corporation', model: 'ILME-FX2', deviceVersion: '1.01', serialNumber: '' })
 const decoded = dataset.decode(encoded).value
 expect(decoded.operationsSupportedRaw).toEqual([0x1001, 0x9802, 0x9803])
 expect((decoded as any).operationsSupported).toBeUndefined()
})

it('sizes an FX2 original over 4 GiB from its typed property list when the descriptor operation is refused', async () => {
 // Bytes as the bench FX2 (firmware 1.01) returned them on 2026-11-14 for handle 0x40000c19:
 // GetObjectPropDesc -> 0x2005; GetObjectPropList -> count 1, handle, 0xdc04, UINT64, 5,101,088,166 bytes.
 const f = fixture(), original = f.camera.send.getMockImplementation()!, handle = 0x40000c19, size = 5_101_088_166
 f.setBytes(0xffffffff); f.setHandles([1, handle])
 const observed = Uint8Array.from(Buffer.from('01000000190c004004dc0800a66d0c3001000000', 'hex'))
 let list = observed, descriptorCode = 0x2005
 const asked: string[] = []
 f.camera.send.mockImplementation((async (op: any, args: any) => {
  if (op.name === 'GetDeviceInfo') return { code: 0x2001, data: { operationsSupportedRaw: [0x9801, 0x9802, 0x9803, 0x9805] } }
  if (op.name === 'MtpGetObjectPropDesc') { asked.push(op.name); return { code: descriptorCode } }
  if (op.name === 'MtpGetObjectPropValue') throw new Error('the untyped value must not be trusted without a type')
  if (op.name === 'MtpGetObjectPropList') {
   asked.push(op.name)
   expect(args).toEqual({ ObjectHandle: handle, ObjectFormatCode: 0, ObjectPropertyCode: 0xdc04, GroupCode: 0, Depth: 0 })
   return { code: 0x2001, data: list }
  }
  return original(op, args)
 }) as any)
 const sized = () => (f.recording as any).originalSize(handle, 0xffffffff, 0xb982)
 expect(await sized()).toBe(size)
 expect(asked).toEqual(['MtpGetObjectPropDesc', 'MtpGetObjectPropList'])
 expect(await (f.recording as any).originalSize(handle, 1234, 0xb982)).toBe(1234)
 // Another handle's entry, another type, or a truncated reply is never accepted as this original's size.
 const altered = (change: (view: DataView) => void) => { const copy = observed.slice(); change(new DataView(copy.buffer)); return copy }
 list = altered(view => view.setUint32(4, handle + 1, true)); await expect(sized()).rejects.toThrow('UINT64')
 list = altered(view => view.setUint16(10, 6, true)); await expect(sized()).rejects.toThrow('UINT64')
 list = altered(view => view.setUint32(0, 2, true)); await expect(sized()).rejects.toThrow('UINT64')
 list = observed.slice(0, 16); await expect(sized()).rejects.toThrow('complete 64-bit')
 list = altered(view => view.setBigUint64(12, 4096n, true)); await expect(sized()).rejects.toThrow('invalid 64-bit')
 // A refusal other than "not supported" is not papered over.
 list = observed; descriptorCode = 0x2002; await expect(sized()).rejects.toThrow('descriptor is unavailable')
})
