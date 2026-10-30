import {readNikonWirelessStatus} from '@vendors/nikon/wireless-status'
import {describe,expect,it,vi} from 'vitest'
import {createNikonRegistry} from '@ptp/registry'
import {DevicePropDescCodec} from '@ptp/datasets/device-prop-desc-dataset'

function fixture({manufacturer='Nikon Corporation',model='Z6_3',advertised=true,malformed=false,queryFailure=false,pathValue=0,pathAdvertised=false,pathWrongProperty=false,pathThrow=false}={}) {
    const integer=(value:number)=>{const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value,true);return bytes}
    const send=vi.fn(async(operation:{code:number})=>{
        if(operation.code===0x1001)return {code:0x2001,data:{manufacturer,model,operationsSupportedRaw:advertised?[0x9358,0x936d,0x90eb]:[],devicePropertiesSupported:pathAdvertised?[0xd12e]:[]}}
        if(queryFailure)return {code:0x2005}
        if(operation.code===0x943a||operation.code===0x1014){
            if(pathThrow)throw new Error('Descriptor unsupported')
            return {code:0x2001,data:{devicePropertyCode:pathWrongProperty?0x5001:0xd12e,currentValueRaw:pathValue}}
        }
        if(operation.code===0x9358)return {code:0x2001,data:integer(3)}
        if(operation.code===0x936d)return {code:0x2001,data:integer(1)}
        const bytes=new Uint8Array(malformed?3:59)
        if(!malformed)new DataView(bytes.buffer).setUint16(0,200,true)
        return {code:0x2001,data:bytes}
    })
    return {send,getInstance:()=>({registry:createNikonRegistry(true)})}
}

describe('Nikon wireless prerequisite diagnostics',()=>{
    it('reads advertised capabilities without writes, credentials, or a false radio-ready claim',async()=>{
        const camera=fixture()
        const result=await readNikonWirelessStatus(camera as any)
        expect(result.usbProvisioning).toBe('ftp-only')
        expect(result.automaticRadioActivation).toBe('unverified')
        expect(result.wifiControl).toBe('not-active')
        expect(result.queries.WsGetResponderCfg).toEqual({advertised:true,queried:true,response:0x2001,configurationVersion:200,profileCount:0})
        expect(camera.send.mock.calls.map(([operation])=>operation.code)).toEqual([0x1001,0x9358,0x936d,0x90eb,0x943a])
        expect(JSON.stringify(result)).not.toMatch(/passphrase|ssid|hostGuid/i)
    })
    it('uses only physically verified WTU reads for the known Z6 III DeviceInfo omission',async()=>{
        const camera=fixture({advertised:false})
        const result=await readNikonWirelessStatus(camera as any)
        expect(result.usbProvisioning).toBe('ftp-only')
        expect(result.queries.WsGetSupportedProfileType).toEqual({advertised:false,queried:true,response:0x2001,value:1})
        expect(camera.send).toHaveBeenCalledTimes(5)
    })
    it('does not send unadvertised vendor operations',async()=>{
        const camera=fixture({advertised:false,model:'D850'})
        expect((await readNikonWirelessStatus(camera as any)).usbProvisioning).toBe('unverified')
        expect(camera.send).toHaveBeenCalledOnce()
    })
    it('does not call unsupported capabilities successful or infer FTP from a failed response',async()=>{
        const result=await readNikonWirelessStatus(fixture({queryFailure:true}) as any)
        expect(result.usbProvisioning).toBe('unverified')
        expect(result.queries.WsGetSupportedProfileType?.response).toBe(0x2005)
    })
    it('rejects malformed profile headers',async()=>{
        await expect(readNikonWirelessStatus(fixture({malformed:true}) as any)).rejects.toThrow('truncated')
    })
    it('refuses a non-Nikon body before any vendor query',async()=>{
        const camera=fixture({manufacturer:'Canon'})
        await expect(readNikonWirelessStatus(camera as any)).rejects.toThrow('Nikon')
        expect(camera.send).toHaveBeenCalledOnce()
    })
})


describe('Nikon actual connection path',()=>{
    it.each([[0,'usb'],[2,'wifi'],[3,'ethernet'],[255,'unknown']] as const)('reports raw path %s as %s without claiming provisioning or control readiness',async(value,path)=>{
        const camera=fixture({pathValue:value})
        const result=await readNikonWirelessStatus(camera as any)
        expect(result.connectionPath).toEqual({advertised:false,queried:true,response:0x2001,value,path})
        expect(result.wifiControl).toBe(path==='wifi'?'connected':path==='unknown'?'unverified':'not-active')
        if(path==='wifi')expect(result.nextSteps.join(' ')).not.toContain('create and enable')
        expect(result.automaticRadioActivation).toBe('unverified')
        expect(camera.send).toHaveBeenLastCalledWith(expect.objectContaining({code:0x943a}),{DevicePropCode:0xd12e})
    })
    it('uses the standard descriptor for an advertised property on older Nikon bodies',async()=>{
        const camera=fixture({model:'D850',advertised:false,pathAdvertised:true,pathValue:2})
        expect((await readNikonWirelessStatus(camera as any)).connectionPath).toEqual({advertised:true,queried:true,response:0x2001,value:2,path:'wifi'})
        expect(camera.send).toHaveBeenLastCalledWith(expect.objectContaining({code:0x1014}),{DevicePropCode:0xd12e})
    })
    it('does not probe an unadvertised property on an unvalidated model',async()=>{
        const camera=fixture({model:'D850',advertised:false})
        expect((await readNikonWirelessStatus(camera as any)).connectionPath).toEqual({advertised:false,queried:false,path:'unknown'})
        expect(camera.send).toHaveBeenCalledOnce()
    })
    it('preserves unsupported, malformed and failed reads as unknown',async()=>{
        for(const options of [{queryFailure:true},{pathWrongProperty:true},{pathThrow:true},{pathValue:-1},{pathValue:256},{pathValue:1.5}]){
            expect((await readNikonWirelessStatus(fixture(options) as any)).connectionPath.path).toBe('unknown')
            expect((await readNikonWirelessStatus(fixture(options) as any)).connectionPath.value).toBeUndefined()
        }
    })
    it('decodes a real descriptor while preserving unknown future connection values',()=>{
        const registry=createNikonRegistry(true),codec=new DevicePropDescCodec(registry,true)
        for(const value of [0,2,3,255]){
            const bytes=new Uint8Array([0x2e,0xd1,0,0,2,0,0,0,value,0])
            const result=codec.decode(bytes).value
            expect(result.devicePropertyName).toBe('ConnectionPath')
            expect(result.currentValueRaw).toBe(value)
            expect(result.currentValueDecoded).toBe(value)
        }
    })
})
