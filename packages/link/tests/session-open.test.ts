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
