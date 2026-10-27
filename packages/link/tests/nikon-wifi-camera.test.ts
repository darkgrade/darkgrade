import {beforeEach,describe,expect,it,vi} from 'vitest'
const fixture=vi.hoisted(()=>({connect:vi.fn(),disconnect:vi.fn(),transportDisconnect:vi.fn(),send:vi.fn(),transport:vi.fn()}))
vi.mock('@transport/ip/ip-transport',()=>({IPTransport:class{constructor(options:unknown){fixture.transport(options)}disconnect=fixture.transportDisconnect}}))
vi.mock('@camera/index',()=>({Camera:class{connect=fixture.connect;disconnect=fixture.disconnect;send=fixture.send;getInstance(){return{registry:{operations:{GetDeviceInfo:'info'}}}}}}))
import {connectNikonWifiCamera} from '@vendors/nikon/wifi-camera'
import {GetDevicePropDescEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
const options={address:'192.0.2.1',clientGuid:Uint8Array.from({length:16},(_,index)=>index+1),expectedSerialNumber:'3023406'}
beforeEach(()=>{vi.resetAllMocks();fixture.connect.mockResolvedValue(undefined);fixture.disconnect.mockResolvedValue(undefined);fixture.send.mockImplementation(async(operation:unknown)=>operation==='info'?{code:0x2001,data:{manufacturer:'Nikon Corporation',model:'Z6_3',serialNumber:'00003023406'}}:{code:0x2001,data:{devicePropertyCode:0xd12e,currentValueRaw:2}})})
describe('verified Nikon Wi-Fi connection',()=>{
 it('preserves controller identity and verifies the active control path',async()=>{
  expect(await connectNikonWifiCamera(options)).toMatchObject({model:'Z6_3',connectionPath:'wifi',verified:true})
  expect(fixture.transport).toHaveBeenCalledWith(expect.objectContaining({clientGuid:options.clientGuid,timeout:5000}))
  expect(fixture.send.mock.calls.map(call=>call[0])).toEqual(['info',GetDevicePropDescEx])
  expect(fixture.disconnect).not.toHaveBeenCalled()
 })
 it.each([0,3,255,undefined])('rejects an unverified Wi-Fi path %s',async(value)=>{
  fixture.send.mockResolvedValueOnce({code:0x2001,data:{manufacturer:'Nikon',model:'Z6_3',serialNumber:'3023406'}}).mockResolvedValueOnce({code:0x2001,data:{devicePropertyCode:0xd12e,currentValueRaw:value}})
  await expect(connectNikonWifiCamera(options)).rejects.toThrow('active control path')
  expect(fixture.disconnect).toHaveBeenCalledOnce()
 })
 it('rejects another camera before reading settings',async()=>{
  fixture.send.mockResolvedValue({code:0x2001,data:{manufacturer:'Nikon',serialNumber:'999'}})
  await expect(connectNikonWifiCamera(options)).rejects.toThrow('identity')
  expect(fixture.send).toHaveBeenCalledOnce()
 })
 it('cleans up failed handshakes and preserves the error',async()=>{
  fixture.connect.mockRejectedValue(new Error('Pair on camera first'));fixture.disconnect.mockRejectedValue(new Error('Session unavailable'))
  await expect(connectNikonWifiCamera(options)).rejects.toThrow('Pair on camera first')
  expect(fixture.transportDisconnect).toHaveBeenCalledOnce()
 })
 it('requires stable identity and bounded timeouts before opening sockets',async()=>{
  for(const invalid of [{clientGuid:new Uint8Array(16)},{clientGuid:new Uint8Array(15)},{expectedSerialNumber:''},{timeoutMilliseconds:Infinity}])await expect(connectNikonWifiCamera({...options,...invalid})).rejects.toThrow()
  expect(fixture.transport).not.toHaveBeenCalled()
 })
})
