import type { Camera } from '@camera/index'
import { isCamera } from '@camera/camera-context'
import { protocolAccess, protocolSession, type ProtocolSession } from '@camera/protocol-session'
import { normalizeCameraPower, readStandardPower, type PowerProperty } from '@vendors/power-reading'
import type { CameraPower } from '@workflows/camera-power'

export { normalizeCameraPower } from '@vendors/power-reading'

/** Read one standard battery descriptor on an already-owned PTP session. Never write or reconnect. */
export async function readStandardCameraPower(target:Camera|Pick<ProtocolSession,'send'>):Promise<CameraPower|undefined>{
    return readStandardPower(protocolAccess(target))
}

type PowerSession=Pick<ProtocolSession,'send'> & {
    getSonyPropertyStates?:()=>Promise<PowerProperty[]>
    getCanonPropertyStates?:()=>Promise<PowerProperty[]>
    getCanonUnknownPropertyStates?:()=>Promise<PowerProperty[]>
}

/** Reuse an owned camera session for battery telemetry over USB or Sony SDK Wi-Fi. */
export async function readCameraPower(target:Camera|PowerSession,vendor:'sony'|'canon'|'standard'):Promise<CameraPower|undefined>{
    const camera:PowerSession=isCamera(target)?protocolSession(target):target
    if(vendor==='sony'&&camera.getSonyPropertyStates)return normalizeCameraPower('sony',await camera.getSonyPropertyStates())
    const standard=await readStandardCameraPower(camera)
    if(standard?.percent!==undefined||vendor==='standard')return standard
    if(vendor==='canon')return normalizeCameraPower('canon',[...await camera.getCanonPropertyStates?.()||[],...await camera.getCanonUnknownPropertyStates?.()||[]])
    return undefined
}
