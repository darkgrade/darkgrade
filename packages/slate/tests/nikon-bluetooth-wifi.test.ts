import {describe,it,expect} from 'vitest'
import {nikonAuthenticationDigest,requestNikonWifi} from '../src/vendors/nikon/bluetooth-wifi'
const bytes=(hex:string)=>Uint8Array.from(Buffer.from(hex,'hex'))
const options={controllerIdentity:bytes('01e53a3c51a4da3f'),challenge:bytes('dbe113ec44a17d67'),expectedSerialNumber:'0000003023406',expectedName:'fixture-camera'}
const second=bytes('0229fa26805e3d94b9e4f2b3a8136ad516')
// Independent PyCryptodome CBC fixture; the authentication transcript is a public Z50 II vector.
const configuration=bytes('014d7ac2b79cb6ddb514c3f49e192f1c266239846099a404feb8737a25608f72074d7ac2b79cb6ddb5cffd627c37e3fcfa5b1e2ce84842309709003fe0e7d8456991c12dd529db36ec9ee7ce4794a632bbab9ed2f7fe048e8448ff42350d69ffee01')
function channel(serial='03023406'){
 const writes:{code:number;value:Uint8Array}[]=[],messages:Uint8Array[]=[]
 return {writes,messages,
  read:async(code:number)=>code===0x2004?configuration:new TextEncoder().encode(code===0x2003?'fixture-camera':serial),
  write:async(code:number,value:Uint8Array)=>{writes.push({code,value})},
  exchangeAuthentication:async(value:Uint8Array)=>{messages.push(value);return messages.length===1?second:new Uint8Array([4,...new Uint8Array(8),...new TextEncoder().encode('01045835')])},
 }
}
describe('Nikon registered smart-device Wi-Fi',()=>{
 it('matches independent digest and captured response vectors',async()=>{
  expect(Buffer.from(nikonAuthenticationDigest(new Uint8Array([1,0,0,0,0,0,0,0]))).readBigUInt64LE()).toBe(1669531122762555401n)
  const transport=channel(),result=await requestNikonWifi(transport,options)
  expect(Buffer.from(transport.messages[1]).toString('hex')).toBe('03dbe113ec44a17d6753adf179358a8323')
  expect(result).toEqual({ssid:'fixture-network',password:'fixture-password',security:1,serialNumber:'03023406'})
  expect(transport.writes).toEqual([{code:0x2005,value:new Uint8Array([1])}])
 })
 it('requires the authenticated GATT serial, independently of the auth identifier',async()=>{
  const transport=channel('03023407')
  await expect(requestNikonWifi(transport,options)).rejects.toThrow('identity differs')
  expect(transport.writes).toHaveLength(0)
 })
 it('rejects a changed camera challenge before requesting network credentials',async()=>{
  const transport=channel();transport.exchangeAuthentication=async()=>{const bad=second.slice();bad[16]^=1;return bad}
  await expect(requestNikonWifi(transport,options)).rejects.toThrow('did not verify')
  expect(transport.writes).toHaveLength(0)
 })
 it('requires a persisted valid identity and concrete camera serial',async()=>{
  await expect(requestNikonWifi(channel(),{...options,controllerIdentity:new Uint8Array(8)})).rejects.toThrow('persisted')
  await expect(requestNikonWifi(channel(),{...options,expectedSerialNumber:'0000'})).rejects.toThrow('serial')
 })
})
