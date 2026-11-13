import { describe, expect, it, vi, afterEach } from 'vitest'
import { createCanonRegistry } from '../src/ptp/registry'
import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

function camera() {
    const instance = new CanonCamera({isLittleEndian:()=>true,on:()=>{}} as unknown as TransportInterface,
        new Logger({expanded:false,captureConsole:false,renderInTerminal:false}))
    const state = instance as any
    state.supportedOperations = new Set([0x911d])
    instance.send = vi.fn(async()=>({code:0x2001})) as any
    return {instance,state}
}

afterEach(()=>vi.restoreAllMocks())

describe('Canon KeepDeviceOn operation', () => {
    it('registers the parameterless EOS timer-reset command', () => {
        const operation = createCanonRegistry(true).operations.CanonKeepDeviceOn

        expect(operation.code).toBe(0x911d)
        expect(operation.dataDirection).toBe('none')
        expect(operation.operationParameters).toEqual([])
    })

    it('defaults to a ten-second heartbeat and does not rewrite power settings',async()=>{
        const {instance,state}=camera()
        let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now)
        await state.maintainKeepAlive()
        now=9999;await state.maintainKeepAlive()
        expect(instance.send).toHaveBeenCalledTimes(1)
        now=10000;await state.maintainKeepAlive()
        expect(instance.send).toHaveBeenCalledTimes(2)
        expect((instance.send as any).mock.calls.every(([operation]:any[])=>operation.code===0x911d)).toBe(true)
    })

    it('honors opt-out, capability omission and reconnect capability reset',async()=>{
        const {instance,state}=camera()
        instance.setKeepAliveEnabled(false);await state.maintainKeepAlive()
        instance.setKeepAliveEnabled(true);state.supportedOperations=new Set()
        await state.maintainKeepAlive();expect(instance.send).not.toHaveBeenCalled()
        state.supportedOperations=new Set([0x911d]);await state.maintainKeepAlive()
        state.clearCachedState();await state.maintainKeepAlive()
        expect(instance.send).toHaveBeenCalledTimes(1)
        state.supportedOperations=new Set([0x911d]);await state.maintainKeepAlive()
        expect(instance.send).toHaveBeenCalledTimes(2)
    })

    it('rejects explicit failures and never labels a refused heartbeat successful',async()=>{
        const {instance,state}=camera()
        instance.send=vi.fn(async()=>({code:0x200f})) as any
        await expect(instance.keepDeviceOn()).rejects.toThrow()
        expect(state.lastKeepAliveAttempt).toBeUndefined()
        state.supportedOperations=new Set()
        await expect(instance.keepDeviceOn()).rejects.toThrow('was not advertised')
        expect(instance.send).toHaveBeenCalledTimes(1)
    })

    it('backs off failures and stops sending unsupported commands for this connection',async()=>{
        const {instance,state}=camera()
        let now=0;vi.spyOn(performance,'now').mockImplementation(()=>now)
        instance.send=vi.fn(async()=>({code:0x2019})) as any
        await expect(state.maintainKeepAlive()).rejects.toThrow()
        now=9999;await state.maintainKeepAlive();expect(instance.send).toHaveBeenCalledTimes(1)
        now=10000;instance.send=vi.fn(async()=>({code:0x2005})) as any
        await expect(state.maintainKeepAlive()).rejects.toThrow()
        now=20000;await state.maintainKeepAlive();expect(instance.send).toHaveBeenCalledTimes(1)
    })

    it('polls serially and stops without sending a command after disconnect starts',async()=>{
        const {instance,state}=camera()
        let release!:()=>void
        instance.send=vi.fn(async operation=>{
            if(operation.code===0x911d)await new Promise<void>(resolve=>release=resolve)
            return {code:0x2001,data:[]}
        }) as any
        state.startPolling()
        await Promise.resolve()
        const stopped=state.stopPolling()
        release();await stopped
        expect(instance.send).toHaveBeenCalledTimes(1)
    })
})
