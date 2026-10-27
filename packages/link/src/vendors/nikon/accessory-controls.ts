import type {Camera} from '@camera/index'
import type {OperationDefinition} from '@ptp/types/operation'
import {readNikonRecordingStatus} from '@vendors/nikon/recording-status'
import {NikonMenuController} from '@vendors/nikon/menu-controls'

export type NikonAccessoryKey='menu'|'up'|'down'|'left'|'right'|'ok'|'playback'|'display'
export type NikonAccessoryState='not-ready'|'needs-camera-confirmation'|'ready'
export interface NikonAccessorySoftwareConfirmationOptions {
    restoreCameraMode:'PC_CAMERA'|'REMOTE'
    /** Verify a fresh preview shows the remote-grip confirmation prompt; may use OCR or computer vision. */
    verifyConfirmationPrompt:()=>Promise<boolean>
}
export interface NikonAccessoryInfo {
    identity:readonly [number,number]
    version:string
    level:number
    flag:boolean
}

const activeInstances=new WeakSet<object>()
const keyStates:Record<NikonAccessoryKey,readonly number[]>={
    menu:[0,0,2,0,0],up:[0,1,0,0,0],down:[0,2,0,0,0],
    left:[128,0,0,0,0],right:[64,0,0,0,0],ok:[0,64,0,0,0],
    playback:[0,0,4,0,0],display:[0,0,64,0,0],
}

/** Five-byte accessory button state; the last two dial bytes remain neutral. */
export function encodeNikonAccessoryKey(key:NikonAccessoryKey):Uint8Array{
    if(!Object.hasOwn(keyStates,key))throw new Error('Unsupported Nikon accessory key')
    return new Uint8Array(keyStates[key])
}

/** Optional accessory metadata. Does not enable or approve remote control. */
export function encodeNikonAccessoryInfo(info:NikonAccessoryInfo):Uint8Array{
    if(!Array.isArray(info.identity)||info.identity.length!==2||info.identity.some(value=>!Number.isInteger(value)||value<0||value>255))throw new Error('Nikon accessory identity requires two bytes')
    if(typeof info.version!=='string'||info.version.length<1||info.version.length>8||/[^\x20-\x7e]/.test(info.version))throw new Error('Nikon accessory version must be 1–8 printable ASCII characters')
    if(!Number.isInteger(info.level)||info.level<0||info.level>100||typeof info.flag!=='boolean')throw new Error('Invalid Nikon accessory metadata')
    const bytes=new Uint8Array(2+1+(info.version.length+1)*2+2)
    bytes.set(info.identity);bytes[2]=info.version.length+1
    const view=new DataView(bytes.buffer)
    for(let index=0;index<info.version.length;index++)view.setUint16(3+index*2,info.version.charCodeAt(index),true)
    bytes[bytes.length-2]=info.level;bytes[bytes.length-1]=Number(info.flag)
    return bytes
}

const accessoryInfo={code:0x9455,name:'NikonAccessoryInfo',description:'Send optional accessory metadata',dataDirection:'in',operationParameters:[],responseParameters:[]} as const satisfies OperationDefinition
const accessoryReady={code:0x9456,name:'NikonAccessoryReady',description:'Request accessory readiness; camera confirmation may be required',dataDirection:'none',operationParameters:[],responseParameters:[]} as const satisfies OperationDefinition
const accessoryKeys={code:0x9457,name:'NikonAccessoryKeys',description:'Send a five-byte accessory key state',dataDirection:'in',operationParameters:[],responseParameters:[]} as const satisfies OperationDefinition
const needsConfirmation=(code:number)=>code===0x2019||code===0x200f
const sleep=(milliseconds:number)=>new Promise(resolve=>setTimeout(resolve,milliseconds))
type AccessoryCamera=Pick<Camera,'send'|'getInstance'>

/** One persistent Nikon PTP session. Command acceptance never verifies a visible menu change. */
export class NikonAccessoryController {
    private currentState:NikonAccessoryState='not-ready'
    private ownedSession:number|null=null
    private ownedInstance:ReturnType<Camera['getInstance']>|undefined
    private busy=false
    private operationInstance:ReturnType<Camera['getInstance']>|undefined

    constructor(private readonly camera:AccessoryCamera){}

    get state():NikonAccessoryState{
        if(this.ownedInstance&&(this.camera.getInstance()!==this.ownedInstance||this.ownedInstance.sessionId!==this.ownedSession||this.ownedSession===null))this.invalidate()
        return this.currentState
    }

    /** Requests readiness once. Never registers accessory metadata unless explicitly supplied. */
    async requestReady(info?:NikonAccessoryInfo):Promise<{state:NikonAccessoryState;responseCode:number}>{
        const metadata=info===undefined?undefined:encodeNikonAccessoryInfo(info)
        this.acquire()
        try{return await this.prepare(metadata)}finally{this.release()}
    }

    /** Uses one verified software OK press on the validated body/firmware, then leaves navigation service mode. */
    async requestReadyWithSoftwareConfirmation(options:NikonAccessorySoftwareConfirmationOptions):Promise<{state:NikonAccessoryState;responseCode:number}>{
        if(typeof options.verifyConfirmationPrompt!=='function')throw new Error('Provide fresh visual verification of the Nikon remote-grip confirmation prompt')
        this.acquire()
        try{
            const menu=new NikonMenuController(this.camera)
            const result=await menu.run({restoreCameraMode:options.restoreCameraMode},async navigation=>{
                let readiness=await this.prepare()
                // AccessDenied is not evidence of a confirmation dialog. DeviceBusy alone is insufficient too.
                if(readiness.state==='needs-camera-confirmation'&&readiness.responseCode===0x2019){
                    const visible=await options.verifyConfirmationPrompt()
                    this.requireSession()
                    if(visible===true){await navigation.press('ok');readiness=await this.prepare()}
                }
                return readiness
            })
            this.requireSession()
            return result
        }catch(error){this.invalidate();throw error}
        finally{this.release()}
    }

    private async prepare(metadata?:Uint8Array):Promise<{state:NikonAccessoryState;responseCode:number}>{
        this.invalidate()
        const instance=this.operationInstance!,session=instance.sessionId
        if(session===null)throw new Error('Open a Nikon PTP session before requesting accessory control')
        this.ownedInstance=instance;this.ownedSession=session
        try{
            this.requireSession()
            const information=await this.camera.send(instance.registry.operations.GetDeviceInfo,{})
            this.requireSession()
            if(information.code!==0x2001||!information.data||!/nikon/i.test(information.data.manufacturer))throw new Error('Accessory control requires a responding Nikon camera')
            await this.requireIdle()
            this.requireSession()
            if(metadata){
                const registered=await this.camera.send(accessoryInfo,{},metadata)
                this.requireSession()
                if(registered.code!==0x2001)return this.readinessResponse(registered.code)
            }
            const reply=await this.camera.send(accessoryReady,{})
            this.requireSession()
            return this.readinessResponse(reply.code)
        }catch(error){this.invalidate();throw error}
    }

    /** Presses a navigation key for 120 ms and always attempts a neutral release on the same session. */
    async press(key:NikonAccessoryKey):Promise<{commandSent:true;released:true;visualVerificationRequired:true}>{
        const payload=encodeNikonAccessoryKey(key)
        this.acquire()
        try{
            if(this.state!=='ready')throw new Error('Nikon accessory control is not ready; confirm the remote grip on the camera first')
            this.requireSession()
            await this.requireIdle()
            this.requireSession()
            let failure:unknown,failed=false
            try{
                const pressed=await this.camera.send(accessoryKeys,{},payload)
                this.requireSession()
                if(pressed.code!==0x2001){this.readinessFailure(pressed.code);throw new Error(`Nikon accessory key was rejected: 0x${pressed.code.toString(16)}`)}
                await sleep(120)
            }catch(error){failed=true;failure=error;if(this.currentState==='ready')this.currentState='not-ready'}
            finally{
                try{
                    this.requireSession()
                    const released=await this.camera.send(accessoryKeys,{},new Uint8Array(5))
                    this.requireSession()
                    if(released.code!==0x2001){this.readinessFailure(released.code);throw new Error(`Nikon accessory release was rejected: 0x${released.code.toString(16)}`)}
                }catch(error){
                    this.invalidate()
                    throw new AggregateError(failed?[failure,error]:[error],'Nikon accessory key release is unconfirmed; no further keys were sent')
                }
            }
            if(failed)throw failure
            return {commandSent:true,released:true,visualVerificationRequired:true}
        }finally{this.release()}
    }

    private acquire(){
        const instance=this.camera.getInstance()
        if(this.busy||activeInstances.has(instance))throw new Error('Nikon accessory operation is already in progress')
        this.busy=true;this.operationInstance=instance;activeInstances.add(instance)
    }
    private release(){if(this.operationInstance)activeInstances.delete(this.operationInstance);this.operationInstance=undefined;this.busy=false}
    private invalidate(){this.currentState='not-ready';this.ownedSession=null;this.ownedInstance=undefined}
    private requireSession(){
        if(!this.ownedInstance||this.camera.getInstance()!==this.ownedInstance||this.ownedSession===null||this.ownedInstance.sessionId!==this.ownedSession){this.invalidate();throw new Error('Nikon PTP session changed; request accessory readiness again')}
    }
    private async requireIdle(){
        const recording=await readNikonRecordingStatus(this.camera)
        if(!recording||recording.recording||recording.bufferedImages)throw new Error('Nikon must confirm recording and pending card writes are idle before accessory controls')
    }
    private readinessFailure(code:number){this.currentState=needsConfirmation(code)?'needs-camera-confirmation':'not-ready'}
    private readinessResponse(code:number){
        if(code===0x2001)this.currentState='ready'
        else if(needsConfirmation(code))this.currentState='needs-camera-confirmation'
        else{this.currentState='not-ready';throw new Error(`Nikon accessory readiness was rejected: 0x${code.toString(16)}`)}
        return {state:this.currentState,responseCode:code}
    }
}
