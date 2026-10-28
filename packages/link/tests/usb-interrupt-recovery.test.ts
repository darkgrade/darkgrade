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
afterEach(()=>{vi.restoreAllMocks()})
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

describe('USB camera serial selection', () => {
 it('opens the requested body when two cameras have the same USB model', async () => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  const first = {vendorId:0x054c,productId:0x0f4a,serialNumber:'other',open:vi.fn()}, selected = {vendorId:0x054c,productId:0x0f4a,serialNumber:'wanted',open:vi.fn().mockRejectedValue(new Error('selected body'))}
  vi.spyOn(transport,'getUSB').mockResolvedValue({})
  vi.spyOn(transport,'discover').mockResolvedValue([
   {vendorId:0x054c,productId:0x0f4a,serialNumber:'other',device:first},
   {vendorId:0x054c,productId:0x0f4a,serialNumber:'wanted',device:selected},
  ])
  vi.spyOn(console,'log').mockImplementation(()=>{})
  await expect(transport.connect({usb:{filters:[{vendorId:0x054c,productId:0x0f4a,serialNumber:'wanted'}]}})).rejects.toThrow('selected body')
  expect(first.open).not.toHaveBeenCalled();expect(selected.open).toHaveBeenCalledOnce()
 })
 it('refuses another body when the requested serial is absent', async () => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  const device = {open:vi.fn()}
  vi.spyOn(transport,'getUSB').mockResolvedValue({})
  vi.spyOn(transport,'discover').mockResolvedValue([{vendorId:0x054c,productId:0x0f4a,serialNumber:'other',device}])
  vi.spyOn(console,'log').mockImplementation(()=>{})
  await expect(transport.connect({usb:{filters:[{vendorId:0x054c,productId:0x0f4a,serialNumber:'wanted'}]}})).rejects.toThrow('No matching device')
  expect(device.open).not.toHaveBeenCalled()
 })
})


describe('USB halt recovery errors', () => {
 it.each([EndpointType.BULK_IN, EndpointType.BULK_OUT, EndpointType.INTERRUPT])('retains a disconnect failure for %s', async type => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  const failure = new Error('LIBUSB_TRANSFER_NO_DEVICE')
  transport.device = {clearHalt:vi.fn().mockRejectedValue(failure)}
  transport.endpoints = {bulkIn:{endpointNumber:1},bulkOut:{endpointNumber:2},interrupt:{endpointNumber:3}}
  await expect(transport.clearHalt(type)).rejects.toBe(failure)
  expect(transport.device.clearHalt).toHaveBeenCalledWith(type === EndpointType.BULK_OUT ? 'out' : 'in', type === EndpointType.INTERRUPT ? 3 : type === EndpointType.BULK_OUT ? 2 : 1)
 })
 it.each(['LIBUSB_TRANSFER_CANCELLED','LIBUSB_TRANSFER_ERROR'])('allows the existing %s recovery case', async message => {
  const transport:any = new USBTransport(new Logger({captureConsole:false,renderInTerminal:false}))
  transport.device = {clearHalt:vi.fn().mockRejectedValue(new Error(message))}
  transport.endpoints = {interrupt:{endpointNumber:3}}
  await expect(transport.clearHalt(EndpointType.INTERRUPT)).resolves.toBeUndefined()
 })
})
