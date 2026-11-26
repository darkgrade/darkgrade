import {EventEmitter} from 'node:events'
import {Logger} from '@core/logger'
import {PTPDisconnectedError} from '@core/ptp-errors'
import {USBTransport} from '@transport/usb/usb-transport'
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
afterEach(()=>{vi.restoreAllMocks()})
describe('USB event polling recovery',()=>{
 it('rearms a failed event listener only after the old transfer ends',async()=>{
  const {endpoint,clear}=fixture();endpoint.emit('error',new Error('LIBUSB_TRANSFER_ERROR'))
  expect(clear).not.toHaveBeenCalled();expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
  endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))
  expect(clear).toHaveBeenCalledWith('interrupt');expect(endpoint.startPoll).toHaveBeenCalledTimes(2)
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

describe('USB halt recovery errors', () => {
 it.each(['bulkIn', 'bulkOut', 'interrupt'])('retains a disconnect failure for %s', async type => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  const failure = new Error('LIBUSB_TRANSFER_NO_DEVICE')
  transport.device = {clearHalt:vi.fn().mockRejectedValue(failure)}
  transport.endpoints = {bulkIn:{endpointNumber:1},bulkOut:{endpointNumber:2},interrupt:{endpointNumber:3}}
  await expect(transport.clearHalt(type)).rejects.toBe(failure)
  expect(transport.device.clearHalt).toHaveBeenCalledWith(type === 'bulkOut' ? 'out' : 'in', type === 'interrupt' ? 3 : type === 'bulkOut' ? 2 : 1)
 })
 it('treats a cancelled clear as the endpoint\'s own teardown', async () => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  transport.device = {clearHalt:vi.fn().mockRejectedValue(new Error('LIBUSB_TRANSFER_CANCELLED'))}
  transport.endpoints = {interrupt:{endpointNumber:3}}
  await expect(transport.clearHalt('interrupt')).resolves.toBeUndefined()
 })
 it('reports a clear that failed: the halt is still there', async () => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  const failure = new Error('LIBUSB_TRANSFER_ERROR')
  transport.device = {clearHalt:vi.fn().mockRejectedValue(failure)}
  transport.endpoints = {interrupt:{endpointNumber:3}}
  await expect(transport.clearHalt('interrupt')).rejects.toBe(failure)
 })
})

describe('USB device removal cleanup', () => {
 it('marks physical removal disconnected without restarting a dead endpoint', async () => {
  const {endpoint,transport,clear}=fixture()
  endpoint.emit('error',new Error('LIBUSB_TRANSFER_NO_DEVICE'))
  endpoint.emit('end');await new Promise(resolve=>setImmediate(resolve))
  expect(transport.isConnected()).toBe(false)
  expect(clear).not.toHaveBeenCalled()
  expect(endpoint.startPoll).toHaveBeenCalledTimes(1)
  endpoint.emit('data',Buffer.alloc(12));expect(transport.handleInterruptData).not.toHaveBeenCalled()
 })
 it('closes the native handle after removal even though isConnected is false', async () => {
  const {endpoint,transport,clear}=fixture()
  const close=vi.fn().mockResolvedValue(undefined);transport.device={close}
  endpoint.emit('error',new Error('LIBUSB_TRANSFER_NO_DEVICE'));endpoint.emit('end')
  await transport.disconnect()
  expect(close).toHaveBeenCalledOnce();expect(clear).not.toHaveBeenCalled()
  expect(transport.device).toBeNull();expect(transport.endpoints).toBeNull()
 })
 it.each(['clearHalt error: Error: LIBUSB_ERROR_NO_DEVICE','unexpected halt failure'])('still closes the handle after %s', async message => {
  const {transport,clear}=fixture(),failure=new Error(message)
  const close=vi.fn().mockResolvedValue(undefined);transport.device={close}
  clear.mockRejectedValue(failure)
  if(message.includes('NO_DEVICE'))await expect(transport.disconnect()).resolves.toBeUndefined()
  else await expect(transport.disconnect()).rejects.toBe(failure)
  expect(close).toHaveBeenCalledOnce();expect(transport.device).toBeNull();expect(transport.isConnected()).toBe(false)
 })
 it('clears references and preserves both failures when halt and close fail', async () => {
  const {transport,clear}=fixture(),haltFailure=new Error('halt failed'),closeFailure=new Error('close failed')
  clear.mockRejectedValue(haltFailure);transport.device={close:vi.fn().mockRejectedValue(closeFailure)}
  const failure=await transport.disconnect().catch((error:unknown)=>error)
  expect(failure).toBeInstanceOf(AggregateError);expect(failure.errors).toEqual([haltFailure,closeFailure])
  expect(transport.device).toBeNull();expect(transport.endpoints).toBeNull()
 })
 it('ends fallback interrupt reads after a missing device instead of spinning', async () => {
  const transport:any=new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  transport.connected=true;transport.endpoints={interrupt:{endpointNumber:3}}
  const read=vi.fn().mockRejectedValueOnce(new Error('LIBUSB_TRANSFER_NO_DEVICE')).mockImplementationOnce(async()=>{transport.connected=false;throw new Error('unexpected retry')})
  transport.device={transferIn:read}
  await transport.listenForInterrupt()
  expect(read).toHaveBeenCalledOnce();expect(transport.isConnected()).toBe(false)
 })
})

describe('USB device removal', () => {
 function attached(transferIn: () => Promise<unknown>) {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  transport.connected = true
  transport.device = {transferIn:vi.fn(transferIn),transferOut:vi.fn(transferIn),close:vi.fn().mockResolvedValue(undefined)}
  transport.endpoints = {bulkIn:{endpointNumber:1},bulkOut:{endpointNumber:2},interrupt:{endpointNumber:3}}
  vi.spyOn(console,'error').mockImplementation(()=>{})
  return transport
 }
 it('reports an unplug during a read as PTPDisconnectedError and refuses further transfers', async () => {
  const transport = attached(() => Promise.reject(new Error('LIBUSB_TRANSFER_NO_DEVICE')))
  const endpoint:any = new EventEmitter();endpoint.pollActive = true
  endpoint.stopPoll = vi.fn((done:()=>void)=>{endpoint.pollActive=false;done()})
  transport.pollingEndpoint = endpoint
  await expect(transport.receive(512,1,1)).rejects.toBeInstanceOf(PTPDisconnectedError)
  expect(transport.isConnected()).toBe(false)
  expect(endpoint.stopPoll).toHaveBeenCalledOnce()
  await expect(transport.send(new Uint8Array(12),1,2)).rejects.toBeInstanceOf(PTPDisconnectedError)
  expect(transport.device.transferOut).not.toHaveBeenCalled()
  await transport.disconnect()
  expect(transport.device).toBeNull()
 })
 it('backs off and gives up on an event endpoint that keeps failing', async () => {
  vi.useFakeTimers()
  try {
   const transport = attached(() => Promise.reject(new Error('LIBUSB_TRANSFER_ERROR')))
   const loop = transport.listenForInterrupt()
   await vi.runAllTimersAsync();await loop
   expect(transport.device.transferIn).toHaveBeenCalledTimes(4)
  } finally { vi.useRealTimers() }
 })
})
