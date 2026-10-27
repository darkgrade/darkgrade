import {afterEach,describe,expect,it,vi} from 'vitest'
import {NikonAccessoryController,encodeNikonAccessoryInfo,encodeNikonAccessoryKey} from '@vendors/nikon/accessory-controls'
import {createNikonRegistry} from '@ptp/registry'

function fixture(options:{manufacturer?:string;readyCode?:number;recording?:number|null;pressCode?:number;releaseCode?:number;throwPress?:boolean;changeSessionOnPress?:boolean;readyCodes?:number[];menuExitCode?:number;restoreCode?:number;rejectPress?:boolean;pressFailure?:unknown;onInfo?:()=>void}={}){
    const instance={sessionId:41 as number|null,registry:createNikonRegistry(true)}
    const send=vi.fn(async(operation:{code:number},_parameters:unknown,data?:Uint8Array)=>{
        if(operation.code===0x1001){options.onInfo?.();return {code:0x2001,data:{manufacturer:options.manufacturer??'Nikon Corporation',model:'Z6_3',deviceVersion:'V2.00'}}}
        if(operation.code===0x943a)return {code:0x2001,data:options.recording===null?undefined:{devicePropertyCode:0xd0a4,currentValueRaw:options.recording??0}}
        if(operation.code===0x9456)return {code:options.readyCodes?.shift()??options.readyCode??0x2001}
        if(operation.code===0x94fd)return {code:0x2001,parameters:[(_parameters as any).Command===0xf002?(options.menuExitCode??0x2001):0x2001]}
        if(operation.code===0x90c2)return {code:options.restoreCode??0x2001}
        if(operation.code===0x9457&&data?.some(byte=>byte!==0)){
            if(options.changeSessionOnPress)instance.sessionId=42
            if(options.throwPress)throw new Error('USB transfer failed')
            if(options.rejectPress)throw options.pressFailure
            return {code:options.pressCode??0x2001}
        }
        if(operation.code===0x9457)return {code:options.releaseCode??0x2001}
        return {code:0x2001}
    })
    const camera={send,getInstance:()=>instance},controller=new NikonAccessoryController(camera as any)
    return {camera,controller,instance,send}
}
afterEach(()=>vi.useRealTimers())

describe('Nikon accessory wire encodings',()=>{
    it.each([
        ['menu','0000020000'],['up','0001000000'],['down','0002000000'],['left','8000000000'],
        ['right','4000000000'],['ok','0040000000'],['playback','0000040000'],['display','0000400000'],
    ] as const)('encodes %s with neutral dial bytes', (key,hex)=>{
        expect(Buffer.from(encodeNikonAccessoryKey(key)).toString('hex')).toBe(hex)
    })
    it('rejects shutter, movie, unknown and prototype key names',()=>{
        for(const key of ['half','full','movie','function','__proto__','toString'])expect(()=>encodeNikonAccessoryKey(key as any)).toThrow('Unsupported')
    })
    it('encodes optional metadata with counted UTF16LE string and bounded bytes',()=>{
        expect([...encodeNikonAccessoryInfo({identity:[7,8],version:'1.0',level:50,flag:true})]).toEqual([7,8,4,49,0,46,0,48,0,0,0,50,1])
        for(const info of [
            {identity:[-1,0],version:'1',level:0,flag:false},
            {identity:[0,256],version:'1',level:0,flag:false},
            {identity:[0,0],version:'',level:0,flag:false},
            {identity:[0,0],version:'123456789',level:0,flag:false},
            {identity:[0,0],version:'1\0',level:0,flag:false},
            {identity:[0,0],version:'1',level:101,flag:false},
        ])expect(()=>encodeNikonAccessoryInfo(info as any)).toThrow()
    })
})

describe('persistent Nikon accessory control',()=>{
    it.each([0x2019,0x200f])('returns needs-camera-confirmation for 0x%s without retrying or claiming ready',async(readyCode)=>{
        const {controller,send}=fixture({readyCode})
        expect(await controller.requestReady()).toEqual({state:'needs-camera-confirmation',responseCode:readyCode})
        expect(send.mock.calls.map(([operation])=>operation.code)).toEqual([0x1001,0x943a,0x9456])
        await expect(controller.press('menu')).rejects.toThrow('not ready')
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toEqual([])
    })
    it('presses for 120ms and releases with exactly five neutral bytes on the same session',async()=>{
        vi.useFakeTimers()
        const {controller,send}=fixture()
        expect(await controller.requestReady()).toEqual({state:'ready',responseCode:0x2001})
        const pressed=controller.press('menu')
        await vi.advanceTimersByTimeAsync(119)
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(await pressed).toEqual({commandSent:true,released:true,visualVerificationRequired:true})
        const keys=send.mock.calls.filter(([operation])=>operation.code===0x9457)
        expect(keys.map(([,parameters,data])=>[parameters,[...data!]])).toEqual([[{},[0,0,2,0,0]],[{},[0,0,0,0,0]]])
        expect(send.mock.calls.some(([operation])=>operation.code===0x9455)).toBe(false)
    })
    it('never sends keys before readiness or to a changed/disconnected PTP session',async()=>{
        const {controller,send,instance}=fixture()
        await expect(controller.press('up')).rejects.toThrow('not ready')
        await controller.requestReady();instance.sessionId=42
        expect(controller.state).toBe('not-ready')
        await expect(controller.press('up')).rejects.toThrow('not ready')
        instance.sessionId=null
        await expect(controller.requestReady()).rejects.toThrow('Open a Nikon PTP session')
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(0)
    })
    it.each([{recording:0x400},{recording:0x200},{recording:null}])('rejects busy or unconfirmed idle state %s before a handshake',async(options)=>{
        const {controller,send}=fixture(options)
        await expect(controller.requestReady()).rejects.toThrow('confirm recording')
        expect(send.mock.calls.some(([operation])=>operation.code===0x9456||operation.code===0x9457)).toBe(false)
    })
    it('checks recording again before every key rather than trusting initial idle evidence',async()=>{
        const options={recording:0}, {controller,send}=fixture(options)
        await controller.requestReady();options.recording=0x400
        await expect(controller.press('menu')).rejects.toThrow('confirm recording')
        expect(send.mock.calls.some(([operation])=>operation.code===0x9457)).toBe(false)
    })
    it('rejects non-Nikon cameras before any accessory write',async()=>{
        const {controller,send}=fixture({manufacturer:'Canon Inc.'})
        await expect(controller.requestReady()).rejects.toThrow('responding Nikon')
        expect(send).toHaveBeenCalledOnce()
    })
    it.each([{pressCode:0x2019},{throwPress:true}])('attempts neutral release after a failed press %s',async(options)=>{
        const {controller,send}=fixture(options)
        await controller.requestReady()
        await expect(controller.press('left')).rejects.toThrow()
        const keys=send.mock.calls.filter(([operation])=>operation.code===0x9457)
        expect(keys).toHaveLength(2)
        expect([...keys[1]![2]!]).toEqual([0,0,0,0,0])
        expect(controller.state).not.toBe('ready')
    })
    it('does not send a release into a new PTP session after a mid-press disconnect',async()=>{
        const {controller,send}=fixture({changeSessionOnPress:true})
        await controller.requestReady()
        await expect(controller.press('ok')).rejects.toThrow('release is unconfirmed')
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(1)
        expect(controller.state).toBe('not-ready')
    })
    it('invalidates readiness when release fails and blocks further keys',async()=>{
        vi.useFakeTimers()
        const {controller,send}=fixture({releaseCode:0x200f})
        await controller.requestReady()
        const pressed=expect(controller.press('down')).rejects.toThrow('release is unconfirmed')
        await vi.advanceTimersByTimeAsync(120);await pressed
        await expect(controller.press('down')).rejects.toThrow('not ready')
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(2)
    })
    it('serializes operation ownership so overlapping keys cannot release each other',async()=>{
        vi.useFakeTimers()
        const {controller}=fixture();await controller.requestReady()
        const pressed=controller.press('right')
        await expect(controller.press('left')).rejects.toThrow('already in progress')
        await vi.advanceTimersByTimeAsync(120);await pressed
    })
    it('registers optional metadata only when explicitly supplied before the readiness request',async()=>{
        const {controller,send}=fixture()
        await controller.requestReady({identity:[7,8],version:'1',level:1,flag:false})
        expect(send.mock.calls.map(([operation])=>operation.code)).toEqual([0x1001,0x943a,0x9455,0x9456])
    })
    it('rejects unknown key names without issuing even read commands',async()=>{
        const {controller,send}=fixture();await controller.requestReady();send.mockClear()
        await expect(controller.press('movie' as any)).rejects.toThrow('Unsupported')
        expect(send).not.toHaveBeenCalled()
    })
})


describe('Nikon accessory ownership and automatic confirmation',()=>{
    it('prevents distinct controllers from pressing or preparing concurrently on the same camera',async()=>{
        vi.useFakeTimers()
        const {camera,controller,send}=fixture(),other=new NikonAccessoryController(camera as any)
        await controller.requestReady();await other.requestReady()
        const pressed=controller.press('menu')
        await expect(other.press('up')).rejects.toThrow('already in progress')
        await expect(other.requestReady()).rejects.toThrow('already in progress')
        await vi.advanceTimersByTimeAsync(120);await pressed
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(2)
        await other.requestReady()
    })
    it.each([undefined,null,0,''])('never reports a failed press as accepted when the rejection is falsy: %s',async(pressFailure)=>{
        const {controller,send}=fixture({rejectPress:true,pressFailure})
        await controller.requestReady()
        await expect(controller.press('menu')).rejects.toBe(pressFailure)
        expect(controller.state).toBe('not-ready')
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9457)).toHaveLength(2)
    })
    it('does not even read recording status on a replacement session after an identity query reconnects',async()=>{
        const setup=fixture({onInfo:()=>{setup.instance.sessionId=42}})
        await expect(setup.controller.requestReady()).rejects.toThrow('session changed')
        expect(setup.send.mock.calls.map(([operation])=>operation.code)).toEqual([0x1001])
        expect(setup.controller.state).toBe('not-ready')
    })
    it('confirms one visually verified grip prompt, retries readiness once and restores mode before returning ready',async()=>{
        const {controller,send}=fixture({readyCodes:[0x2019,0x2001]})
        const verifyConfirmationPrompt=vi.fn(async()=>true)
        expect(await controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt})).toEqual({state:'ready',responseCode:0x2001})
        expect(controller.state).toBe('ready')
        expect(verifyConfirmationPrompt).toHaveBeenCalledOnce()
        const menu=send.mock.calls.filter(([operation])=>operation.code===0x94fd).map(([,parameters])=>parameters)
        expect(menu).toEqual([
            {Command:0xf001,Argument1:0,Argument2:0,Argument3:0,Argument4:0},
            {Command:0xf094,Argument1:1,Argument2:0,Argument3:0,Argument4:0},
            {Command:0xf2ba,Argument1:0x27,Argument2:50,Argument3:0,Argument4:0},
            {Command:0xf002,Argument1:0,Argument2:0,Argument3:0,Argument4:0},
        ])
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9456)).toHaveLength(2)
        expect(send.mock.calls.at(-1)).toEqual([expect.objectContaining({code:0x90c2}),{Mode:'PC_CAMERA'}])
    })
    it.each([false,undefined,{}])('never sends OK when visual confirmation does not return exactly true: %s',async(visible)=>{
        const {controller,send}=fixture({readyCode:0x2019})
        expect(await controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'REMOTE',verifyConfirmationPrompt:async()=>visible as any})).toEqual({state:'needs-camera-confirmation',responseCode:0x2019})
        expect(send.mock.calls.some(([operation,parameters])=>operation.code===0x94fd&&(parameters as any).Command===0xf2ba)).toBe(false)
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9456)).toHaveLength(1)
    })
    it('does not press OK or inspect a possibly unrelated preview after AccessDenied',async()=>{
        const {controller,send}=fixture({readyCode:0x200f}),verifyConfirmationPrompt=vi.fn(async()=>true)
        expect(await controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt})).toEqual({state:'needs-camera-confirmation',responseCode:0x200f})
        expect(verifyConfirmationPrompt).not.toHaveBeenCalled()
        expect(send.mock.calls.some(([operation,parameters])=>operation.code===0x94fd&&(parameters as any).Command===0xf2ba)).toBe(false)
    })
    it('keeps readiness honest when one verified OK press is insufficient',async()=>{
        const {controller,send}=fixture({readyCode:0x2019})
        expect(await controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt:async()=>true})).toEqual({state:'needs-camera-confirmation',responseCode:0x2019})
        expect(send.mock.calls.filter(([operation])=>operation.code===0x9456)).toHaveLength(2)
        expect(send.mock.calls.filter(([operation,parameters])=>operation.code===0x94fd&&(parameters as any).Command===0xf2ba)).toHaveLength(1)
    })
    it.each([{menuExitCode:0x200f},{restoreCode:0x2019}])('invalidates readiness when service cleanup fails after handshake success: %s',async(options)=>{
        const {controller}=fixture(options)
        await expect(controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt:async()=>true})).rejects.toThrow('cleanup is unconfirmed')
        expect(controller.state).toBe('not-ready')
    })
    it('cleans up the service and invalidates readiness if preview verification throws',async()=>{
        const {controller,send}=fixture({readyCode:0x2019})
        await expect(controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt:async()=>{throw new Error('Preview unavailable')}})).rejects.toThrow('Preview unavailable')
        expect(controller.state).toBe('not-ready')
        expect(send.mock.calls.some(([operation,parameters])=>operation.code===0x94fd&&(parameters as any).Command===0xf002)).toBe(true)
        expect(send.mock.calls.at(-1)?.[0].code).toBe(0x90c2)
    })
    it('holds ownership for the whole confirmation flow, including the visual verification await',async()=>{
        let finishVerification!:(value:boolean)=>void
        const verification=new Promise<boolean>(resolve=>{finishVerification=resolve})
        const {controller,camera}=fixture({readyCode:0x2019}),other=new NikonAccessoryController(camera as any)
        let enteredVerification!:()=>void
        const started=new Promise<void>(resolve=>{enteredVerification=resolve})
        const preparing=controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA',verifyConfirmationPrompt:async()=>{enteredVerification();return verification}})
        await started
        await expect(other.requestReady()).rejects.toThrow('already in progress')
        await expect(other.press('menu')).rejects.toThrow('already in progress')
        finishVerification(false);await preparing
        await other.requestReady()
    })
    it('requires a visual verification hook before any camera command',async()=>{
        const {controller,send}=fixture()
        await expect(controller.requestReadyWithSoftwareConfirmation({restoreCameraMode:'PC_CAMERA'} as any)).rejects.toThrow('visual verification')
        expect(send).not.toHaveBeenCalled()
    })
})
