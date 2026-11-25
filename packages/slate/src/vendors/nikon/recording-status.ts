import type {Camera} from '@camera/index'
import {protocolAccess,type ProtocolSession} from '@camera/protocol-session'
import {GetDevicePropDescEx} from '@vendors/nikon/definitions/nikon-operation-definitions'
import {MovieRecProhibitionCondition} from '@vendors/nikon/definitions/nikon-property-definitions'

/** Fresh read on an owned Nikon session, including bodies omitting this descriptor from DeviceInfo. */
export async function readNikonRecordingStatus(target:Camera|Pick<ProtocolSession,'send'>){
    const camera=protocolAccess(target)
    try{
        const response=await camera.send(GetDevicePropDescEx,{DevicePropCode:MovieRecProhibitionCondition.code})
        const descriptor=response.data,flags=descriptor?.currentValueRaw
        if(response.code!==0x2001||descriptor?.devicePropertyCode!==MovieRecProhibitionCondition.code||typeof flags!=='number'||!Number.isInteger(flags)||flags<0||flags>0xffffffff)return undefined
        return {confirmed:true as const,source:'nikon-ptp-0xd0a4' as const,observedAt:new Date().toISOString(),prohibitionBits:flags,recording:Boolean(flags&0x400),bufferedImages:Boolean(flags&0x200)}
    }catch{return undefined}
}

/** Throws `message` unless a fresh read confirms no recording and no pending card writes. */
export async function requireNikonIdle(target:Camera|Pick<ProtocolSession,'send'>,message:string){
    const status=await readNikonRecordingStatus(target)
    if(!status||status.recording||status.bufferedImages)throw new Error(message)
}
