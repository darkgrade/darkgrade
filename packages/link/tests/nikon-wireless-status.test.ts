import {readNikonWirelessStatus} from '@vendors/nikon/wireless-status'
import {describe,expect,it,vi} from 'vitest'

function fixture({manufacturer='Nikon Corporation',model='Z6_3',advertised=true,malformed=false,queryFailure=false}={}) {
    const integer=(value:number)=>{const bytes=new Uint8Array(4);new DataView(bytes.buffer).setUint32(0,value,true);return bytes}
    const send=vi.fn(async(operation:{code:number})=>{
        if(operation.code===0x1001)return {code:0x2001,data:{manufacturer,model,operationsSupportedRaw:advertised?[0x9358,0x936d,0x90eb]:[]}}
        if(queryFailure)return {code:0x2005}
        if(operation.code===0x9358)return {code:0x2001,data:integer(3)}
        if(operation.code===0x936d)return {code:0x2001,data:integer(1)}
        const bytes=new Uint8Array(malformed?3:59)
        if(!malformed)new DataView(bytes.buffer).setUint16(0,200,true)
        return {code:0x2001,data:bytes}
    })
    return {send,getInstance:()=>({registry:{operations:{GetDeviceInfo:{code:0x1001}}}})}
}

describe('Nikon wireless prerequisite diagnostics',()=>{
    it('reads advertised capabilities without writes, credentials, or a false radio-ready claim',async()=>{
        const camera=fixture()
        const result=await readNikonWirelessStatus(camera as any)
        expect(result.usbProvisioning).toBe('ftp-only')
        expect(result.automaticRadioActivation).toBe('unverified')
        expect(result.wifiControl).toBe('requires-camera-setup')
        expect(result.queries.WsGetResponderCfg).toEqual({advertised:true,queried:true,response:0x2001,configurationVersion:200,profileCount:0})
        expect(camera.send.mock.calls.map(([operation])=>operation.code)).toEqual([0x1001,0x9358,0x936d,0x90eb])
        expect(JSON.stringify(result)).not.toMatch(/passphrase|ssid|hostGuid/i)
    })
    it('uses only physically verified WTU reads for the known Z6 III DeviceInfo omission',async()=>{
        const camera=fixture({advertised:false})
        const result=await readNikonWirelessStatus(camera as any)
        expect(result.usbProvisioning).toBe('ftp-only')
        expect(result.queries.WsGetSupportedProfileType).toEqual({advertised:false,queried:true,response:0x2001,value:1})
        expect(camera.send).toHaveBeenCalledTimes(4)
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
