import {afterEach,describe,expect,it,vi} from 'vitest'

const fixture=vi.hoisted(()=>({version:undefined as string|undefined,output:[] as string[]}))
vi.mock('@core/logger',()=>({Logger:class{}}))
vi.mock('@transport/usb/usb-transport',()=>({USBTransport:class{
 connected=false
 async connect(){this.connected=true}
 async disconnect(){this.connected=false}
 isConnected(){return this.connected}
}}))
vi.mock('@transport/ip/ip-transport',()=>({IPTransport:class{
 connected=false
 async connect(){this.connected=true}
 async disconnect(){this.connected=false}
 isConnected(){return this.connected}
}}))
const cameraFixture=()=>({
 registry:{operations:{GetDeviceInfo:{code:0x1001},CloseSession:{code:0x1003}}},
 async send(operation:{code:number}){return {code:0x2001,...(operation.code===0x1001?{data:{manufacturer:'Fixture manufacturer',model:'Fixture camera',deviceVersion:fixture.version,serialNumber:'fixture-serial',operationsSupportedRaw:[0x1001]}}:{})}},
 async getCanonPropertyStates(){return []},async getCanonUnknownPropertyStates(){return []},getCanonNetworkState(){return {}},
})
vi.mock('@camera/generic-camera',()=>({GenericCamera:class{
 sessionId=0
 registry=cameraFixture().registry
 send=cameraFixture().send
 constructor(private transport:any){}
 async disconnect(){await this.transport.disconnect()}
}}))
vi.mock('@camera/index',()=>({Camera:class{
 registry=cameraFixture().registry
 send=cameraFixture().send
 getCanonPropertyStates=cameraFixture().getCanonPropertyStates
 getCanonUnknownPropertyStates=cameraFixture().getCanonUnknownPropertyStates
 getCanonNetworkState=cameraFixture().getCanonNetworkState
 constructor(private options:any){}
 async connect(){await this.options.transport.connect()}
 async disconnect(){await this.options.transport.disconnect()}
 getInstance(){return this}
}}))
const originalArguments=process.argv,originalExitCode=process.exitCode
afterEach(()=>{process.argv=originalArguments;process.exitCode=originalExitCode;vi.restoreAllMocks()})
for(const transport of ['usb','ptpip'])describe(transport+' identity firmware forwarding',()=>{
 for(const version of ['3-1.0.1','  2.00\0',undefined])it('preserves reported firmware '+JSON.stringify(version),async()=>{
  vi.resetModules();fixture.version=version;fixture.output=[]
  process.argv=transport==='usb'?['node','bench-probe.ts','--camera','04a9:32f5']:['node','bench-ptpip.ts','--host','127.0.0.1','--local-address','127.0.0.1','--action','probe']
  vi.spyOn(process.stdout,'write').mockImplementation(chunk=>{fixture.output.push(String(chunk));return true})
  if(transport==='usb')await import('./bench-probe')
  else await import('./bench-ptpip')
  const result=JSON.parse(fixture.output.join('').trim())
  expect(result.responsive).toBe(true);expect(result.device.model).toBe('Fixture camera')
  if(version===undefined)expect(result.device).not.toHaveProperty('deviceVersion')
  else expect(result.device.deviceVersion).toBe(version)
 })
})
