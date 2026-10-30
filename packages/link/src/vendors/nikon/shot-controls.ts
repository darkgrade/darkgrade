import type {Camera} from '@camera/index'
import {getDatatypeByCode} from '@ptp/definitions/datatype-definitions'
import {GetDevicePropDescEx,SetDevicePropValueEx} from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import {LiveViewSelector} from '@ptp/definitions/vendors/nikon/nikon-property-definitions'
import {prepareNikonManualExposure} from '@vendors/nikon/manual-exposure'
import {readNikonRecordingStatus} from '@vendors/nikon/recording-status'
import type {ShotProperty,ShotSetupReport} from '@workflows/shot-setup'

const properties={iso:0xd1aa,aperture:0xd1a9,shutterSpeed:0xd1a8,shutterMode:0x1d074,shutterAngle:0x1d075,whiteBalance:0xd23a,focusMode:0xd1fa,autoIso:0xd0ad,exposureProgram:0x500e} as const
type PropertyName=keyof typeof properties
type OwnedCamera=Pick<Camera,'send'|'get'|'getInstance'|'getNikonVendorPropertyCodes'>
interface Descriptor {devicePropertyCode:number;dataType:number;getSet:string;formFlag:number;currentValueRaw:unknown;supportedValuesRaw?:unknown[];minimumValue?:unknown;maximumValue?:unknown;stepSize?:unknown}
const actions:Record<string,PropertyName>={'set-iso':'iso','set-aperture':'aperture','set-shutter-speed':'shutterSpeed','set-white-balance':'whiteBalance','set-focus-mode':'focusMode'}

/** Movie controls on one caller-owned persistent session. CloseSession releases REMOTE mode.
 * This class never opens/closes a camera or starts live view, recording, or autofocus.
 */
export class NikonShotControls {
    private readonly instance:ReturnType<Camera['getInstance']>
    private readonly session:number|null
    private descriptors=new Map<PropertyName,Descriptor>()
    private allowedCodes?:Set<number>
    private busy=false

    constructor(private readonly camera:OwnedCamera){this.instance=camera.getInstance();this.session=this.instance.sessionId}

    async prepare(){
        return this.exclusive(async()=>{
            await this.requireVideo()
            const prepare=(this.instance as unknown as {prepareManualVideoExposure?:()=>ReturnType<typeof prepareNikonManualExposure>}).prepareManualVideoExposure
            const exposure=prepare?await prepare.call(this.instance):await prepareNikonManualExposure(this.camera)
            await this.loadDescriptors()
            const previousShutterMode=this.descriptors.get('shutterMode')?.currentValueRaw
            if(Number(previousShutterMode)===2)await this.write('shutterMode',1)
            const changes:ShotSetupReport['changes']=[]
            if(exposure.previous!==1)changes.push({setting:'exposureMode',before:String(exposure.previous),after:'Manual',verified:true})
            if(Number(previousShutterMode)===2)changes.push({setting:'shutterMode',before:'Shutter angle',after:'Shutter speed',verified:true})
            return {...exposure,previousShutterMode,changes,controls:await this.readControls()}
        })
    }

    async read():Promise<Record<string,ShotProperty>>{return this.exclusive(()=>this.readControls())}

    async apply(action:string,value:string):Promise<Record<string,ShotProperty>>{
        return this.exclusive(async()=>{
            const name=Object.hasOwn(actions,action)?actions[action]:undefined
            if(!name)throw new Error('Unsupported Nikon shot action')
            await this.requireIdle()
            const controls=await this.readControls(),control=controls[name]
            const descriptor=this.descriptors.get(name)
            if(!control?.writable||!descriptor)throw new Error('Choose a writable Nikon advertised shot value')
            const numeric=/^-?\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):undefined
            const raw=this.choices(descriptor).find(candidate=>this.label(name,candidate)===value||candidate===numeric)
            if(raw===undefined)throw new Error('Nikon shot value is not advertised')
            if(name==='iso')await this.writeFixedIso(raw)
            else await this.write(name,raw)
            return this.readControls()
        })
    }

    private async exclusive<T>(run:()=>Promise<T>):Promise<T>{
        if(this.busy)throw new Error('Another Nikon shot-control operation is in progress')
        if(this.camera.getInstance()!==this.instance||this.session===null||this.instance.sessionId!==this.session)throw new Error('Nikon shot-control session changed; create a new controller')
        this.busy=true
        try{return await run()}finally{this.busy=false}
    }

    private async requireIdle(){
        const status=await readNikonRecordingStatus(this.camera)
        if(!status||status.recording||status.bufferedImages)throw new Error('Nikon must confirm idle before changing shot settings')
    }

    private async requireVideo(){
        if(await this.camera.get(LiveViewSelector)!=='VIDEO')throw new Error('Nikon shot tuning requires video mode')
    }

    private async descriptor(name:PropertyName,required=false):Promise<Descriptor|undefined>{
        const code=properties[name]
        if(name!=='exposureProgram'&&!this.allowedCodes?.has(code)){
            this.descriptors.delete(name)
            if(required)throw new Error('Nikon does not advertise '+name)
            return undefined
        }
        const response=await this.camera.send(GetDevicePropDescEx,{DevicePropCode:code})
        if(response.code!==0x2001||response.data?.devicePropertyCode!==code||typeof response.data.currentValueRaw!=='number'||!Number.isSafeInteger(response.data.currentValueRaw)){
            this.descriptors.delete(name)
            if(required)throw new Error('Nikon '+name+' descriptor could not be verified')
            return undefined
        }
        const descriptor=response.data as Descriptor
        this.descriptors.set(name,descriptor)
        return descriptor
    }

    private async loadDescriptors(){
        this.allowedCodes=new Set(await this.camera.getNikonVendorPropertyCodes())
        for(const name of Object.keys(properties) as PropertyName[])await this.descriptor(name,name==='iso'||name==='shutterSpeed'||name==='exposureProgram')
    }

    private choices(descriptor:Descriptor):number[]{
        if(descriptor.formFlag===2)return [...new Set((descriptor.supportedValuesRaw||[]).filter((value):value is number=>typeof value==='number'&&Number.isSafeInteger(value)))]
        const minimum=Number(descriptor.minimumValue),maximum=Number(descriptor.maximumValue),step=Number(descriptor.stepSize)
        if(descriptor.formFlag!==1||![minimum,maximum,step].every(Number.isSafeInteger)||step<=0||maximum<minimum||(maximum-minimum)/step>1024)return []
        return Array.from({length:Math.floor((maximum-minimum)/step)+1},(_,index)=>minimum+index*step)
    }

    private label(name:PropertyName,value:number):string{
        if(name==='iso')return `ISO ${value}`
        if(name==='aperture')return `f/${Number((value/100).toFixed(3))}`
        if(name==='shutterSpeed'){
            const numerator=value>>>16,denominator=value&0xffff
            return numerator===1&&denominator>1?`1/${denominator}`:numerator&&denominator?`${Number((numerator/denominator).toFixed(6))}s`:`Unknown shutter (${value})`
        }
        if(name==='whiteBalance')return ({1:'Manual',2:'Auto',3:'One-push auto',4:'Daylight',5:'Fluorescent',6:'Tungsten',7:'Flash',32784:'Cloudy',32785:'Shade',32786:'Color Temperature',32787:'Preset',32788:'Off',32789:'Flash',32790:'Natural light auto'} as Record<number,string>)[value]||`Unknown white balance (${value})`
        if(name==='focusMode')return ({0:'AF-S',1:'AF-C',2:'AF-F',4:'Manual'} as Record<number,string>)[value]||`Unknown focus (${value})`
        return String(value)
    }

    private async readControls():Promise<Record<string,ShotProperty>>{
        await this.requireVideo()
        await this.loadDescriptors()
        const controls:Record<string,ShotProperty>={}
        for(const [name,descriptor] of this.descriptors){
            const choices=this.choices(descriptor),value=Number(descriptor.currentValueRaw)
            const labels=choices.map(choice=>this.label(name,choice))
            controls[name]={value:this.label(name,value),allowedValues:labels,writable:descriptor.getSet==='GET_SET'&&choices.length>0&&new Set(labels).size===labels.length,enabled:true}
        }
        const manual=Number(this.descriptors.get('exposureProgram')?.currentValueRaw)===1
        if(controls.iso){
            const auto=this.descriptors.get('autoIso')?.currentValueRaw
            if(!manual||auto===1)controls.iso.value='Auto'
            if(!manual||auto!==0&&auto!==1)controls.iso.writable=false
        }
        if(controls.shutterSpeed&&Number(this.descriptors.get('shutterMode')?.currentValueRaw)===2)controls.shutterSpeed.writable=false
        return controls
    }

    private async write(name:PropertyName,value:number){
        const descriptor=await this.descriptor(name,true)
        if(!descriptor||descriptor.getSet!=='GET_SET'||!this.choices(descriptor).includes(value))throw new Error('Nikon '+name+' value is not writable and advertised')
        const datatype=getDatatypeByCode(descriptor.dataType)
        if(!datatype?.codec)throw new Error('Nikon shot datatype is unsupported')
        const codec=typeof datatype.codec==='function'?datatype.codec(this.instance.registry):datatype.codec
        const encoded=codec.encode(value)
        if(String(codec.decode(encoded).value)!==String(value))throw new Error('Nikon shot value cannot be encoded without truncation')
        const response=await this.camera.send(SetDevicePropValueEx,{DevicePropCode:properties[name]},encoded)
        if(response.code!==0x2001)throw new Error('Nikon rejected '+name+' with 0x'+response.code.toString(16))
        const readback=await this.descriptor(name,true)
        if(readback?.currentValueRaw!==value)throw new Error('Nikon '+name+' readback did not confirm the requested value')
    }

    private async writeFixedIso(value:number){
        const mode=await this.descriptor('exposureProgram',true)
        if(mode?.currentValueRaw!==1)throw new Error('Nikon must confirm Manual exposure before fixed movie ISO')
        const automatic=await this.descriptor('autoIso',true),previous=automatic?.currentValueRaw
        if(previous!==0&&previous!==1)throw new Error('Nikon Movie Auto ISO state is unknown')
        let changed=false
        try{
            if(previous===1){changed=true;await this.write('autoIso',0)}
            await this.write('iso',value)
        }catch(error){
            if(changed)try{await this.write('autoIso',1)}catch(rollback){throw new Error(`${String(error)}; Movie Auto ISO restoration failed: ${String(rollback)}`)}
            throw error
        }
    }
}
