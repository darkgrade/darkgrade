import {Camera} from '@camera/index'
import {IPTransport} from '@transport/ip/ip-transport'
import {GetDevicePropDescEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'

export interface NikonWifiConnectionOptions {
    address:string
    port?:number
    localAddress?:string
    /** Generate once per controller and persist across reconnects. */
    clientGuid:Uint8Array
    expectedSerialNumber:string
    timeoutMilliseconds?:number
}

/** Connect an already paired, active Nikon Camera Control profile.
 * Does not create profiles, enable the radio or approve pairing.
 * Returns the normal Camera API only after identity and built-in Wi-Fi readback.
 */
export async function connectNikonWifiCamera(options:NikonWifiConnectionOptions){
    if(options.clientGuid.length!==16||!options.clientGuid.some(byte=>byte!==0))throw new Error('Use a persisted, nonzero 16-byte Nikon controller GUID')
    if(!options.address.trim()||!options.expectedSerialNumber.trim()||!options.expectedSerialNumber.replace(/^0+/,''))throw new Error('Nikon Wi-Fi requires an address and expected camera serial number')
    const timeout=options.timeoutMilliseconds??20000
    if(!Number.isFinite(timeout)||timeout<250||timeout>30000)throw new Error('Nikon Wi-Fi timeout must be 250–30000 ms')
    const transport=new IPTransport({address:options.address,port:options.port,localAddress:options.localAddress,clientGuid:options.clientGuid,clientName:'Darkgrade',timeout})
    const camera=new Camera({vendorId:0x04b0,transport,logger:{renderInTerminal:false,captureConsole:false}})
    try{
        await camera.connect()
        const instance=camera.getInstance()
        const reply=await camera.send(instance.registry.operations.GetDeviceInfo,{})
        if(reply.code!==0x2001||!reply.data||!/nikon/i.test(reply.data.manufacturer))throw new Error('Network endpoint did not identify as a Nikon camera')
        const serial=(value:string)=>value.replace(/^0+/,'')
        if(serial(reply.data.serialNumber)!==serial(options.expectedSerialNumber))throw new Error('Nikon Wi-Fi camera identity does not match the selected camera')
        const path=await camera.send(GetDevicePropDescEx,{DevicePropCode:0xd12e})
        if(path.code!==0x2001||path.data?.devicePropertyCode!==0xd12e||path.data?.currentValueRaw!==2)throw new Error('Nikon did not confirm built-in Wi-Fi as the active control path')
        return {camera,model:reply.data.model,connectionPath:'wifi' as const,verified:true as const}
    }catch(error){
        await camera.disconnect().catch(()=>transport.disconnect())
        throw error
    }
}
