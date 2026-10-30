import {decodeNikonPairingCode,pairNikonWifiProfile} from '@vendors/nikon/wifi-pairing'
import {TransportType} from '@transport/interfaces/transport-types'
import type {PTPEvent,TransportInterface} from '@transport/interfaces/transport.interface'
import {USBContainerBuilder,USBContainerType} from '@transport/usb/usb-container'
import {describe,expect,it,vi} from 'vitest'

function response(code:number,transactionId:number) {
    const bytes=USBContainerBuilder.buildCommand(code,transactionId,[])
    new DataView(bytes.buffer).setUint16(4,USBContainerType.RESPONSE,true)
    return bytes
}
function fixture({approve=true,notify=true,operationFailure=false,data=Uint8Array.of(4,0,0,0,0,1,6,2)}={}) {
    let eventHandler:((event:PTPEvent)=>void)|undefined
    const commands:number[]=[]
    const pending:Uint8Array[]=[]
    const transport={
        getType:()=>TransportType.IP,isConnected:()=>true,
        connect:vi.fn(),disconnect:vi.fn(async()=>{}),classRequestReset:vi.fn(),isLittleEndian:()=>true,
        on:(handler:(event:PTPEvent)=>void)=>{eventHandler=handler},
        off:vi.fn(()=>{eventHandler=undefined}),
        send:vi.fn(async(bytes:Uint8Array)=>{
            const command=USBContainerBuilder.parseContainer(bytes)
            commands.push(command.code)
            if(command.code===0x952b)pending.push(USBContainerBuilder.buildData(command.code,command.transactionId,data))
            pending.push(response(operationFailure&&command.code===0x935a?0x2005:0x2001,command.transactionId))
            if(command.code===0x935a&&notify)eventHandler?.({code:0x4008,transactionId:0,parameters:[]})
        }),
        receive:vi.fn(async()=>pending.shift()!),
    } satisfies TransportInterface
    return {transport,commands,options:{experimental:true as const,confirmCode:vi.fn(async()=>approve),confirmationTimeoutMilliseconds:5}}
}

describe('Nikon PTP/IP profile pairing',()=>{
    it('preserves leading zeroes and rejects malformed or ASCII digit datasets',()=>{
        expect(decodeNikonPairingCode(Uint8Array.of(4,0,0,0,0,1,6,2))).toBe('0162')
        for(const bytes of [Uint8Array.of(4),Uint8Array.of(0,0,0,0),Uint8Array.of(1,0,0,0,49),Uint8Array.of(1,0,0,0,1,2)])
            expect(()=>decodeNikonPairingCode(bytes)).toThrow()
    })
    it('opens session then reads PIN first, requires host comparison, and confirms via camera event',async()=>{
        const {transport,commands,options}=fixture()
        await expect(pairNikonWifiProfile(transport,options)).resolves.toEqual({cameraConfirmed:true})
        expect(commands).toEqual([0x1002,0x952b,0x935a])
        expect(options.confirmCode).toHaveBeenCalledWith('0162')
        const confirmation=USBContainerBuilder.parseContainer(transport.send.mock.calls[2]![0])
        expect(new DataView(confirmation.payload.buffer).getUint32(0,true)).toBe(0x2001)
        expect(transport.disconnect).toHaveBeenCalledOnce()
        expect(transport.off).toHaveBeenCalledOnce()
    })
    it('cancels without approving camera when user declines code comparison',async()=>{
        const {transport,commands,options}=fixture({approve:false})
        await expect(pairNikonWifiProfile(transport,options)).rejects.toThrow('not confirmed')
        expect(commands).toEqual([0x1002,0x952b])
        expect(transport.disconnect).toHaveBeenCalledOnce()
    })
    it('bounds an unanswered code comparison and never approves a late answer',async()=>{
        const {transport,commands,options}=fixture()
        let approve!:(value:boolean)=>void
        options.confirmCode=vi.fn(()=>new Promise<boolean>(resolve=>{approve=resolve}))
        await expect(pairNikonWifiProfile(transport,options)).rejects.toThrow('comparison timed out')
        approve(true)
        await Promise.resolve()
        expect(commands).toEqual([0x1002,0x952b])
        expect(transport.disconnect).toHaveBeenCalledOnce()
    })
    it('requires a camera confirmation event rather than treating operation OK as paired',async()=>{
        const {transport,options}=fixture({notify:false})
        await expect(pairNikonWifiProfile(transport,options)).rejects.toThrow('Confirm the computer')
        expect(transport.disconnect).toHaveBeenCalledOnce()
    })
    it('never accepts a failed pairing response even if a confirmation event arrives',async()=>{
        const {transport,options}=fixture({operationFailure:true})
        await expect(pairNikonWifiProfile(transport,options)).rejects.toThrow('0x2005')
        expect(transport.disconnect).toHaveBeenCalledOnce()
    })
    it('disconnects on malformed PIN without displaying or confirming it',async()=>{
        const {transport,commands,options}=fixture({data:Uint8Array.of(1,0,0,0,10)})
        await expect(pairNikonWifiProfile(transport,options)).rejects.toThrow('digit')
        expect(options.confirmCode).not.toHaveBeenCalled()
        expect(commands).toEqual([0x1002,0x952b])
        expect(transport.disconnect).toHaveBeenCalledOnce()
    })
    it('rejects USB and invalid timeouts before sending any command',async()=>{
        const {transport,options}=fixture()
        await expect(pairNikonWifiProfile({...transport,getType:()=>TransportType.USB},options)).rejects.toThrow('not USB')
        await expect(pairNikonWifiProfile(transport,{...options,confirmationTimeoutMilliseconds:Infinity})).rejects.toThrow('timeout')
        await expect(pairNikonWifiProfile(transport,{...options,experimental:false} as any)).rejects.toThrow('experimental opt-in')
        expect(transport.send).not.toHaveBeenCalled()
    })
})
