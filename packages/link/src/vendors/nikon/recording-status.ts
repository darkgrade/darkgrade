import type {Camera} from '@camera/index'
import {GetDevicePropDescEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import {MovieRecProhibitionCondition} from '@ptp/definitions/vendors/nikon/nikon-property-definitions'

/** Fresh read on an owned Nikon session, including bodies omitting this descriptor from DeviceInfo. */
export async function readNikonRecordingStatus(camera:Pick<Camera,'send'>){
    try{
        const response=await camera.send(GetDevicePropDescEx,{DevicePropCode:MovieRecProhibitionCondition.code})
        const descriptor=response.data,flags=descriptor?.currentValueRaw
        if(response.code!==0x2001||descriptor?.devicePropertyCode!==MovieRecProhibitionCondition.code||typeof flags!=='number'||!Number.isInteger(flags)||flags<0||flags>0xffffffff)return undefined
        return {confirmed:true as const,source:'nikon-ptp-0xd0a4' as const,observedAt:new Date().toISOString(),prohibitionBits:flags,recording:Boolean(flags&0x400),bufferedImages:Boolean(flags&0x200)}
    }catch{return undefined}
}
