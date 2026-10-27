import type {Camera} from '@camera/index'
import {GetDevicePropDescEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import {ConnectionPath} from '@ptp/definitions/vendors/nikon/nikon-property-definitions'

/** Official Z6III USB/MTP Rev.2.00 §6.5.15.2; this verifies PTP transport, not provisioned credentials. */
async function readConnectionPath(camera:Camera,information:{model:string;devicePropertiesSupported?:number[]},advertisedOperations:Set<number>){
    const advertised=information.devicePropertiesSupported?.includes(ConnectionPath.code)===true
    const canRead=advertised||information.model==='Z6_3'
    const result:{advertised:boolean;queried:boolean;response?:number;value?:number;path:'usb'|'wifi'|'ethernet'|'unknown'}={advertised,queried:canRead,path:'unknown'}
    if(!canRead)return result
    const operation=advertisedOperations.has(GetDevicePropDescEx.code)||information.model==='Z6_3'
        ?GetDevicePropDescEx:camera.getInstance().registry.operations.GetDevicePropDesc
    try{
        const reply=await camera.send(operation,{DevicePropCode:ConnectionPath.code})
        result.response=reply.code
        const descriptor=reply.data,value=descriptor?.currentValueRaw
        if(reply.code!==0x2001||descriptor?.devicePropertyCode!==ConnectionPath.code||typeof value!=='number'||!Number.isInteger(value)||value<0||value>255)return result
        result.value=value
        result.path=value===0?'usb':value===2?'wifi':value===3?'ethernet':'unknown'
    }catch{ /* Unsupported descriptors cannot establish a connection path. */ }
    return result
}

/** Read-only Nikon WTU capabilities; a USB profile bank is not proof of an active Wi-Fi connection. */
export async function readNikonWirelessStatus(camera:Camera) {
    const instance=camera.getInstance()
    const information=await camera.send(instance.registry.operations.GetDeviceInfo,{})
    if(information.code!==0x2001 || !information.data || !/nikon/i.test(information.data.manufacturer))
        throw new Error('Nikon wireless diagnostics require a responding Nikon camera')
    const advertised=new Set(information.data.operationsSupportedRaw)
    // Nikon Z6 III accepts these official WTU reads despite omitting them from USB DeviceInfo.
    const verifiedModelFallback=information.data.model==='Z6_3'
    const queries=[
        {code:0x9358,name:'WsGetProfileMode'},
        {code:0x936d,name:'WsGetSupportedProfileType'},
        {code:0x90eb,name:'WsGetResponderCfg'},
    ] as const
    const results:Record<string,{advertised:boolean;queried?:boolean;response?:number;value?:number;configurationVersion?:number;profileCount?:number}>={}
    for(const query of queries){
        if(!advertised.has(query.code)&&!verifiedModelFallback){results[query.name]={advertised:false};continue}
        const reply=await camera.send({...query,description:'Read-only Nikon WTU wireless capability query',dataDirection:'out',operationParameters:[],responseParameters:[]} as const,{})
        const result:typeof results[string]={advertised:advertised.has(query.code),queried:true,response:reply.code}
        if(reply.code===0x2001 && reply.data){
            const view=new DataView(reply.data.buffer,reply.data.byteOffset,reply.data.byteLength)
            if(query.name==='WsGetResponderCfg'){
                if(view.byteLength<6)throw new Error('Nikon wireless configuration header is truncated')
                result.configurationVersion=view.getUint16(0,true)
                result.profileCount=view.getUint32(2,true)
                if(result.profileCount>64)throw new Error('Nikon wireless configuration profile count is invalid')
            }else{
                if(view.byteLength!==4)throw new Error('Nikon wireless capability response is malformed')
                result.value=view.getUint32(0,true)
            }
        }
        results[query.name]=result
    }
    const connectionPath=await readConnectionPath(camera,information.data,advertised)
    return {
        model:information.data.model,
        connectionPath,
        usbProvisioning:results.WsGetSupportedProfileType?.value===1?'ftp-only':'unverified',
        automaticRadioActivation:'unverified',
        wifiControl:'requires-camera-setup',
        bluetoothControl:'requires-camera-setup',
        queries:results,
        verifiedModelReadFallback:verifiedModelFallback,
        nextSteps:[
            'On the camera, select Network → Connect to computer → Camera Control, then create and enable a network profile.',
            'Use a stable host GUID for PTP/IP pairing; compare the PIN and confirm the computer on the camera. Z6 III PIN compatibility remains unverified.',
            'For Bluetooth, disconnect USB and other wireless connections, then open Wireless remote (ML-L7) options → Save wireless remote controller on the camera.',
        ],
    }
}
