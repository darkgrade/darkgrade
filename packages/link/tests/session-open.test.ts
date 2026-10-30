import {GenericCamera} from '@camera/generic-camera'
import {Logger} from '@core/logger'
import {describe,expect,it,vi} from 'vitest'
function camera(responses:number[]){const instance=new GenericCamera({isLittleEndian:()=>true,isConnected:()=>true,on:()=>{}}as any,new Logger({renderInTerminal:false,captureConsole:false}));vi.spyOn(instance,'send').mockImplementation(async()=>({code:responses.shift()!})as any);return instance}
describe('confirmed PTP sessions',()=>{
 it('does not report a connection when OpenSession was denied',async()=>{const instance=camera([0x200f]);await expect(instance.connect()).rejects.toThrow('OpenSession failed');expect(instance.sessionId).toBeNull()})
 it('checks reopening after an existing session',async()=>{const instance=camera([0x201e,0x2001,0x200f]);await expect(instance.connect()).rejects.toThrow('OpenSession failed');expect(instance.sessionId).toBeNull()})
 it('does not open over a session that failed to close',async()=>{const instance=camera([0x201e,0x2002]);await expect(instance.connect()).rejects.toThrow('CloseSession failed');expect(instance.send).toHaveBeenCalledTimes(2)})
 it('accepts a confirmed reopened session',async()=>{const instance=camera([0x201e,0x2001,0x2001]);await instance.connect();expect(instance.sessionId).not.toBeNull()})
})

describe('PTP disconnect cleanup',()=>{
 function fixture(connected=true){
  const transport={isLittleEndian:()=>true,isConnected:()=>connected,on:()=>{},disconnect:vi.fn().mockResolvedValue(undefined)}
  const instance=new GenericCamera(transport as any,new Logger({renderInTerminal:false,captureConsole:false}));instance.sessionId=41
  const send=vi.spyOn(instance,'send').mockResolvedValue({code:0x2001} as any)
  return {instance,transport,send}
 }
 it('releases the transport even when CloseSession fails',async()=>{
  const {instance,transport,send}=fixture(),failure=new Error('USB gone during CloseSession')
  send.mockRejectedValue(failure)
  await expect(instance.disconnect()).rejects.toBe(failure)
  expect(transport.disconnect).toHaveBeenCalledOnce();expect(instance.sessionId).toBeNull()
 })
 it('skips wire cleanup on a physically lost connection but releases its handle',async()=>{
  const {instance,transport,send}=fixture(false)
  await instance.disconnect()
  expect(send).not.toHaveBeenCalled();expect(transport.disconnect).toHaveBeenCalledOnce();expect(instance.sessionId).toBeNull()
 })
 it('retains session and transport cleanup errors independently',async()=>{
  const {instance,transport,send}=fixture(),sessionError=new Error('session close failed'),transportError=new Error('handle close failed')
  send.mockRejectedValue(sessionError);transport.disconnect.mockRejectedValue(transportError)
  const failure=await instance.disconnect().catch(error=>error)
  expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toEqual([sessionError,transportError]);expect(instance.sessionId).toBeNull()
 })
})
