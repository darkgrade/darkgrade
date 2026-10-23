import type { Camera } from '@camera/index'
import {GetDevicePropDesc} from '@ptp/definitions/operation-definitions'
import type { CameraPower } from '@workflows/camera-power'

export interface PowerProperty {code?:number; name?: string; value?: unknown; rawValue?: unknown}
function numeric(value: unknown): number | undefined {
    if (typeof value !== 'number' && typeof value !== 'bigint' && typeof value !== 'string') return undefined
    if (typeof value === 'string' && !value.trim()) return undefined
    const number = Number(value)
    return Number.isSafeInteger(number) && number >= 0 ? number : undefined
}

/** Normalize documented units; preserve unsupported/sentinel values as raw evidence. */
export function normalizeCameraPower(vendor: 'sony' | 'canon' | 'standard', properties: PowerProperty[], observedAt = new Date().toISOString()): CameraPower {
    const raw: CameraPower['raw'] = {}
    const read = (name: string) => {
        const property = properties.find(property => property.name === name)
        const value = property?.rawValue ?? property?.value
        if (typeof value === 'number' || typeof value === 'string') raw[name] = value
        if (typeof value === 'bigint') raw[name] = String(value)
        return numeric(value)
    }
    const power: CameraPower = { observedAt, source: vendor === 'sony' ? 'sony-sdk' : vendor === 'canon' ? 'canon-eos-ptp' : 'ptp-battery-level', powerSource: 'unknown', raw }
    if (vendor === 'standard') {
        const percent = read('BatteryLevel')
        if (percent !== undefined && percent <= 100) power.percent = percent
        return power
    }
    if (vendor === 'canon') {
        // EOS 0xd111 is an enum, not a percentage. Unknown body-specific values stay unknown.
        const levels: Record<number, CameraPower['level']> = {0: 'low', 1: 'medium', 2: 'full', 4: 'high', 5: 'low'}
        const value = read('BatteryPower') ?? read('CanonBatteryPower')
        if (value !== undefined) power.level = levels[value]
        return power
    }
    if(properties.some(property=>property.code!==undefined&&property.code>=0x5000))power.source='sony-ptp'
    const remaining = read('BatteryRemain')
    const level = read('BatteryLevel')
    const minutes = read('BatteryRemainingInMinutes')
    const source = read('PowerSource')
    read('BatteryRemainDisplayUnit')
    if (remaining !== undefined && remaining <= 100) power.percent = remaining
    if (minutes !== undefined && minutes < 0xFFFFFFFF) power.remainingMinutes = minutes
    power.powerSource = source === 1 ? 'dc' : source === 2 ? 'battery' : source === 3 ? 'poe' : 'unknown'
    const levels: Record<number, CameraPower['level']> = {1:'low',2:'low',3:'medium',4:'high',5:'full',6:'low',7:'medium',8:'full',65537:'low',65538:'low',65539:'medium',65540:'high',65541:'full'}
    if (level !== undefined) power.level = levels[level]
    if (level !== undefined && level >= 65536 && level <= 65541) power.powerSource = 'usb'
    if (level === 0xFFFFFFFE) power.batteryPresent = false
    return power
}

/** Read one standard battery descriptor on an already-owned PTP session. Never write or reconnect. */
export async function readStandardCameraPower(camera:Pick<Camera,'send'>):Promise<CameraPower|undefined>{
    try{
        const response=await camera.send(GetDevicePropDesc,{DevicePropCode:0x5001})
        const descriptor=response.data
        if(response.code!==0x2001||!descriptor||descriptor.devicePropertyCode!==0x5001)return undefined
        return normalizeCameraPower('standard',[{name:'BatteryLevel',value:descriptor.currentValueRaw}])
    }catch{return undefined}
}
