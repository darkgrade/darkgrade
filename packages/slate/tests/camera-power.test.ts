import {describe,it,expect} from 'vitest'
import {normalizeCameraPower} from '@vendors/camera-power'
import {assessCameraPower} from '@workflows/camera-power'

const standard=(value:number)=>normalizeCameraPower('standard',[{name:'BatteryLevel',value}])

describe('camera battery evidence',()=>{
    it('does not interpret unknown Canon enum values',()=>expect(normalizeCameraPower('canon',[{name:'BatteryPower',rawValue:99}]).level).toBeUndefined())
    it('preserves zero and rejects standard sentinels and malformed values',()=>{
        expect(standard(0).percent).toBe(0)
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
    const now=Date.now()
    it.each([
        ['runtime under the take',{...standard(80),remainingMinutes:29},{status:'fail'}],
        ['runtime inside the reserve',{...standard(80),remainingMinutes:34},{status:'warn'}],
        ['runtime covering take and reserve',{...standard(80),remainingMinutes:35},{status:'pass',runtimeVerified:true}],
        ['charge without a runtime',standard(100),{status:'warn',runtimeVerified:false}],
        ['no telemetry',undefined,{status:'warn'}],
        ['critical charge despite USB and a long estimate',{...standard(5),powerSource:'usb',remainingMinutes:100},{status:'fail'}],
        ['an outlet with zero charge',{...standard(5),powerSource:'dc',percent:0},{status:'warn',runtimeVerified:false}],
        ['a failed refresh',{...standard(100),remainingMinutes:100,lastRefreshError:'Camera busy'},{status:'warn',runtimeVerified:false}],
        ['an invalid timestamp',{...standard(100),remainingMinutes:100,observedAt:'invalid'},{runtimeVerified:false}],
        ['old telemetry',{...standard(100),remainingMinutes:100,observedAt:new Date(now-130000).toISOString()},{runtimeVerified:false}],
        ['future telemetry',{...standard(100),remainingMinutes:100,observedAt:new Date(now+60000).toISOString()},{runtimeVerified:false}],
    ] as const)('assesses a 30-minute take against %s',(_case,power,expected)=>{
        expect(assessCameraPower(power,30)).toMatchObject(expected)
    })
})
