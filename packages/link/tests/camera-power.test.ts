import {describe,it,expect} from 'vitest'
import {normalizeCameraPower} from '@vendors/camera-power'
import {assessCameraPower} from '@workflows/camera-power'

describe('camera battery evidence',()=>{
    it('keeps Canon enum 2 as a coarse full level, never 2%',()=>{
        const power=normalizeCameraPower('canon',[{name:'BatteryPower',rawValue:2}])
        expect(power.level).toBe('full');expect(power.percent).toBeUndefined();expect(power.powerSource).toBe('unknown')
    })
    it('does not interpret unknown Canon enum values',()=>expect(normalizeCameraPower('canon',[{name:'BatteryPower',rawValue:99}]).level).toBeUndefined())
    it('preserves zero and rejects standard sentinels and malformed values',()=>{
        expect(normalizeCameraPower('standard',[{name:'BatteryLevel',value:0}]).percent).toBe(0)
        for(const value of [255,-1,null,'',{},NaN])expect(normalizeCameraPower('standard',[{name:'BatteryLevel',value}]).percent).toBeUndefined()
    })
    it('keeps Sony percentage separate from level, USB supply, charging and runtime',()=>{
        const power=normalizeCameraPower('sony',[{name:'BatteryRemain',value:'84'},{name:'BatteryLevel',value:'65540'},{name:'BatteryRemainingInMinutes',value:'4294967295'}])
        expect(power.percent).toBe(84);expect(power.powerSource).toBe('usb');expect(power.charging).toBeUndefined();expect(power.remainingMinutes).toBeUndefined()
        expect(assessCameraPower(power,30).runtimeVerified).toBe(false)
    })
    it('does not convert Sony missing battery and fake sentinels to charge',()=>{
        const power=normalizeCameraPower('sony',[{name:'BatteryRemain',value:'65535'},{name:'BatteryLevel',value:'4294967294'}])
        expect(power.batteryPresent).toBe(false);expect(power.percent).toBeUndefined();expect(power.level).toBeUndefined()
    })
    it('checks actual estimated runtime against planned take plus reserve',()=>{
        const power=normalizeCameraPower('standard',[{name:'BatteryLevel',value:80}])
        expect(assessCameraPower({...power,remainingMinutes:29},30).status).toBe('fail')
        expect(assessCameraPower({...power,remainingMinutes:34},30).status).toBe('warn')
        expect(assessCameraPower({...power,remainingMinutes:35},30)).toMatchObject({status:'pass',runtimeVerified:true})
    })
    it('never certifies duration from charge, outlet mapping or unknown telemetry',()=>{
        expect(assessCameraPower(normalizeCameraPower('standard',[{name:'BatteryLevel',value:100}]),30)).toMatchObject({status:'warn',runtimeVerified:false})
        expect(assessCameraPower(undefined,30).status).toBe('warn')
    })
    it('critical charge takes priority over an optimistic time estimate or USB power',()=>{
        const power=normalizeCameraPower('standard',[{name:'BatteryLevel',value:5}])
        expect(assessCameraPower({...power,powerSource:'usb',remainingMinutes:100},30).status).toBe('fail')
        expect(assessCameraPower({...power,powerSource:'dc',percent:0},30)).toMatchObject({status:'warn',runtimeVerified:false})
    })
    it('does not present old, invalid or future telemetry as current',()=>{
        const power=normalizeCameraPower('standard',[{name:'BatteryLevel',value:100}])
        expect(assessCameraPower({...power,remainingMinutes:100,lastRefreshError:'Camera busy'},30)).toMatchObject({status:'warn',runtimeVerified:false})
        for(const observedAt of ['invalid',new Date(Date.now()-130000).toISOString(),new Date(Date.now()+60000).toISOString()])expect(assessCameraPower({...power,observedAt,remainingMinutes:100},30).runtimeVerified).toBe(false)
    })
})

it('reads only the standard battery descriptor without a settings write',async()=>{
    const {readStandardCameraPower}=await import('@vendors/camera-power')
    const calls:unknown[]=[]
    const camera={send:async(operation:any,parameters:any)=>{calls.push([operation.code,parameters]);return {code:0x2001,data:{devicePropertyCode:0x5001,currentValueRaw:96}}}}
    expect(await readStandardCameraPower(camera as any)).toMatchObject({percent:96,powerSource:'unknown'})
    expect(calls).toEqual([[0x1014,{DevicePropCode:0x5001}]])
    expect(await readStandardCameraPower({send:async()=>{throw new Error('Not supported')}} as any)).toBeUndefined()
})
it('Sony owned-session battery polling uses existing properties without standard PTP or reconnect',async()=>{
    const {readCameraPower}=await import('@vendors/camera-power')
    const camera={getSonyPropertyStates:async()=>[{name:'BatteryRemain',value:'79'}],send:async()=>{throw new Error('No second protocol path')}}
    expect(await readCameraPower(camera as any,'sony')).toMatchObject({percent:79,source:'sony-sdk'})
})
