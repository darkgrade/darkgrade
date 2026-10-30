import type {Camera} from '@camera/index'
import {ChangeCameraMode,GetDevicePropDescEx,SetDevicePropValueEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import {readNikonRecordingStatus} from '@vendors/nikon/recording-status'

/** Enable remote Manual exposure on an owned idle Nikon session.
 * Leaves REMOTE active on success so the physical dial does not override video settings.
 * Returning to PC_CAMERA (including USB recovery) restores the physical dial's mode.
 */
export async function prepareNikonManualExposure(camera:Pick<Camera,'send'>){
    const idle=await readNikonRecordingStatus(camera)
    if(!idle||idle.recording||idle.bufferedImages)throw new Error('Nikon must confirm idle before enabling remote Manual exposure')
    const remote=await camera.send(ChangeCameraMode,{Mode:'REMOTE'})
    if(remote.code!==0x2001)throw new Error('Nikon rejected remote exposure control')
    try{
        const descriptor=await camera.send(GetDevicePropDescEx,{DevicePropCode:0x500e})
        if(descriptor.code!==0x2001||descriptor.data?.devicePropertyCode!==0x500e)throw new Error('Nikon exposure mode descriptor unavailable')
        const previous=descriptor.data.currentValueRaw
        if(previous!==1){
            if(descriptor.data.getSet!=='GET_SET'||descriptor.data.dataType!==4||!descriptor.data.supportedValuesRaw?.includes(1))throw new Error('Nikon does not advertise writable Manual exposure')
            const written=await camera.send(SetDevicePropValueEx,{DevicePropCode:0x500e},new Uint8Array([1,0]))
            if(written.code!==0x2001)throw new Error('Nikon rejected Manual exposure')
        }
        const readback=await camera.send(GetDevicePropDescEx,{DevicePropCode:0x500e})
        if(readback.code!==0x2001||readback.data?.devicePropertyCode!==0x500e||readback.data.currentValueRaw!==1)throw new Error('Nikon did not confirm Manual exposure')
        return {exposureModeVerified:true as const,previous,mode:'Manual' as const,remoteMode:'REMOTE' as const}
    }catch(error){
        const restored=await camera.send(ChangeCameraMode,{Mode:'PC_CAMERA'})
        if(restored.code!==0x2001)throw new Error(`${String(error)}; Nikon camera-mode restoration failed`)
        throw error
    }
}
