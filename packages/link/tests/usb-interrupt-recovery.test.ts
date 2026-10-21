import {EventEmitter} from 'node:events'
import {Logger} from '@core/logger'
import {USBTransport,EndpointType} from '@transport/usb/usb-transport'
import {describe,it,expect,vi,afterEach} from 'vitest'
function fixture(){
 const transport:any=new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
 const endpoint:any=new EventEmitter();endpoint.startPoll=vi.fn()
 transport.connected=true
 vi.spyOn(transport,'findPollableInterruptEndpoint').mockReturnValue(endpoint)
 const clear=vi.spyOn(transport,'clearHalt').mockResolvedValue(undefined)
 vi.spyOn(transport,'handleInterruptData').mockImplementation(()=>{})
 vi.spyOn(console,'error').mockImplementation(()=>{})
 transport.startInterruptListener()
 return {transport,endpoint,clear}
}
afterEach(()=>vi.restoreAllMocks())
describe('USB event polling recovery',()=>{
 it('rearms a failed event listener only after the old transfer ends',async()=>{
  const {endpoint,clear}=fixture();endpoint.emit('error',new Error('LIBUSB_TRANSFER_ERROR'))
  expect(clear).not.toHaveBeenCalled();expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
  endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))
  expect(clear).toHaveBeenCalledWith(EndpointType.INTERRUPT);expect(endpoint.startPoll).toHaveBeenCalledTimes(2)
 })
 it('does not resurrect event polling after disconnect',async()=>{
  const {endpoint,transport,clear}=fixture();endpoint.emit('error',new Error('failed'));transport.connected=false
  endpoint.emit('end');await Promise.resolve();expect(clear).not.toHaveBeenCalled();expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
 })
 it('does not rearm after disconnect while halt recovery is pending',async()=>{
  const {endpoint,transport,clear}=fixture();let release!:()=>void
  clear.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve}))
  endpoint.emit('error',new Error('failed'));endpoint.emit('end')
  transport.connected=false;release();await new Promise(resolve=>setImmediate(resolve))
  expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
 })
 it('does not recover an event endpoint replaced by a newer connection',async()=>{
  const {endpoint,transport,clear}=fixture();endpoint.emit('error',new Error('failed'));transport.pollingEndpoint={}
  endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))
  expect(clear).not.toHaveBeenCalled();expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
 })
 it('bounds consecutive failures and resets that bound after receiving an event',async()=>{
  const {endpoint}=fixture()
  for(let n=0;n<4;n++){endpoint.emit('error',new Error('failed'));endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))}
  expect(endpoint.startPoll).toHaveBeenCalledTimes(4)
  endpoint.emit('data',Buffer.alloc(12));endpoint.emit('error',new Error('failed'));endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))
  expect(endpoint.startPoll).toHaveBeenCalledTimes(5)
 })
})
