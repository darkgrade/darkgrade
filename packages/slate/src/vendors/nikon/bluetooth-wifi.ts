import {Blowfish} from 'egoroof-blowfish'

export interface NikonSmartDeviceChannel {
    read(characteristic:number):Promise<Uint8Array>
    write(characteristic:number,value:Uint8Array):Promise<void>
    /** Subscribe before writing, then return the next authentication indication. */
    exchangeAuthentication(value:Uint8Array):Promise<Uint8Array>
}

const hex=(value:string)=>Uint8Array.from(value.match(/../g)!,byte=>parseInt(byte,16))
const salts=['704066e40433d552','ed4b8fac15f7e47b','24471f118b5ea1fc','05960c312b8c7f41','fda588c1eba8b1f3','991660561bd3d550','cd32687fa9e28a30','2a8fe834dec7ebf4'].map(hex)
const concatenate=(...values:Uint8Array[])=>Uint8Array.from(values.flatMap(value=>[...value]))
const equal=(left:Uint8Array,right:Uint8Array)=>left.length===right.length&&left.reduce((difference,byte,index)=>difference|(byte^right[index]),0)===0
const decoder=new TextDecoder('utf-8',{fatal:true})

/** Fixed protocol constants are public; controller identities and derived keys are private. */
export function nikonAuthenticationDigest(...blocks:Uint8Array[]):Uint8Array {
    const cipher=new Blowfish(hex('ffffaa5511223300'),Blowfish.MODE.ECB,Blowfish.PADDING.NULL)
    let state=hex('0102030405060708')
    for(const block of blocks){
        if(block.length!==8)throw new Error('Invalid Nikon authentication block')
        state=cipher.encode(state.map((byte,index)=>byte^block[index])).slice(0,8)
    }
    return state
}

function message(value:Uint8Array,stage:number){
    if(value.length!==17||value[0]!==stage)throw new Error('Unexpected Nikon authentication message')
    return {nonce:value.slice(1,9),digest:value.slice(9,17)}
}

/** Authenticate an existing smart-device registration and request its private WPA network.
 * The caller owns Bluetooth discovery/connection and USB handoff. Never logs credentials,
 * creates a bond, or treats radio activation as verified Wi-Fi camera control.
 */
export async function requestNikonWifi(channel:NikonSmartDeviceChannel,options:{controllerIdentity:Uint8Array;expectedSerialNumber:string;expectedName:string;challenge?:Uint8Array}) {
    const identity=options.controllerIdentity,challenge=options.challenge??crypto.getRandomValues(new Uint8Array(8))
    if(identity.length!==8||identity[0]!==1||challenge.length!==8)throw new Error('Invalid persisted Nikon controller identity or challenge')
    if(!/^0*[1-9][0-9]*$/.test(options.expectedSerialNumber)||!options.expectedName.trim())throw new Error('Nikon Wi-Fi requires the registered name and camera serial')
    const second=message(await channel.exchangeAuthentication(concatenate(new Uint8Array([1]),challenge,identity)),2)
    const saltIndex=salts.findIndex(salt=>equal(nikonAuthenticationDigest(salt,second.nonce,challenge),second.digest))
    if(saltIndex<0)throw new Error('Nikon camera authentication did not verify')
    const fourth=message(await channel.exchangeAuthentication(concatenate(new Uint8Array([3]),challenge,nikonAuthenticationDigest(salts[saltIndex],challenge,second.nonce))),4)
    const name=decoder.decode(await channel.read(0x2003)).replace(/\0.*$/s,'').trim()
    const serial=decoder.decode(await channel.read(0x200b)).replace(/^[\0\s]+|[\0\s]+$/g,'')
    if(name!==options.expectedName||!/^\d+$/.test(serial)||serial.replace(/^0+/,'')!==options.expectedSerialNumber.replace(/^0+/,''))throw new Error('Authenticated Nikon identity differs from the selected camera')
    const secret=concatenate(new Uint8Array([saltIndex]),second.nonce.slice(1,4),challenge.slice(0,4))
    const key=nikonAuthenticationDigest(fourth.digest,identity,secret)
    const configuration=await channel.read(0x2004)
    if(configuration.length<98||!(configuration[0]&1)||![1,2,3].includes(configuration[97]))throw new Error('Nikon did not supply a supported protected Wi-Fi network')
    const decrypt=(bytes:Uint8Array)=>{
        const cipher=new Blowfish(key,Blowfish.MODE.CBC,Blowfish.PADDING.NULL)
        cipher.setIv(new Uint8Array(8))
        // NULL unpadding can remove trailing zeros, but embedded padding must remain zero.
        const value=cipher.decode(bytes,Blowfish.TYPE.UINT8_ARRAY) as Uint8Array
        const end=value.indexOf(0),text=end<0?value:value.slice(0,end)
        if(end>=0&&value.slice(end).some(byte=>byte!==0))throw new Error('Invalid Nikon credential padding')
        return decoder.decode(text)
    }
    const ssid=decrypt(configuration.slice(1,33)),password=decrypt(configuration.slice(33,97))
    if(!ssid||new TextEncoder().encode(ssid).length>32||password.length<8||password.length>63)throw new Error('Nikon Wi-Fi credentials did not validate')
    await channel.write(0x2005,new Uint8Array([1]))
    return {ssid,password,security:configuration[97],serialNumber:serial}
}
