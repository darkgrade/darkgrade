/** Nikon Royalmile advertises PTP endpoints through Bonjour. Discovery is not a PTP health check. */
export interface NikonWifiAdvertisement {
    host: string
    port: number
    serviceName: string
    mode: 'camera-control' | 'pairing-required' | 'image-transfer' | 'unsupported'
    usbProductId?: string
    controlVerified: false
}

interface DnsRecord { name: string; type: number; value: string | Record<string,string> | {port:number;target:string}; expiresAt:number }
const serviceSuffix='._ptp._tcp.local'
const decoder=new TextDecoder('utf-8',{fatal:true})

function readName(bytes:Uint8Array,start:number):{name:string;end:number}{
    const labels:string[]=[],visited=new Set<number>()
    let offset=start,end:number|undefined,total=0
    for(let step=0;step<128;step++){
        if(offset>=bytes.length||visited.has(offset))throw new Error('Invalid DNS name')
        visited.add(offset)
        const length=bytes[offset++]!
        if((length&0xc0)===0xc0){
            if(offset>=bytes.length)throw new Error('Truncated DNS pointer')
            end??=offset+1
            offset=((length&0x3f)<<8)|bytes[offset]!
            continue
        }
        if(length&0xc0)throw new Error('Invalid DNS label')
        if(length===0)return {name:labels.join('.').toLowerCase(),end:end??offset}
        if(offset+length>bytes.length||(total+=length+1)>255)throw new Error('Truncated DNS name')
        const label=decoder.decode(bytes.subarray(offset,offset+length))
        if(label.includes('.')||/[\x00-\x1f\x7f]/.test(label))throw new Error('Invalid DNS label text')
        labels.push(label);offset+=length
    }
    throw new Error('Excessive DNS compression')
}

function parseRecords(bytes:Uint8Array,now:number):DnsRecord[]{
    if(bytes.length<12||bytes.length>65535)throw new Error('Invalid DNS packet length')
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
    if(!(view.getUint16(2)&0x8000)||(view.getUint16(2)&0x780f)!==0)return []
    const questions=view.getUint16(4),count=view.getUint16(6)+view.getUint16(8)+view.getUint16(10)
    if(questions>128||count>512)throw new Error('Excessive DNS records')
    let offset=12
    for(let index=0;index<questions;index++){offset=readName(bytes,offset).end+4;if(offset>bytes.length)throw new Error('Truncated DNS question')}
    const records:DnsRecord[]=[]
    for(let index=0;index<count;index++){
        const owner=readName(bytes,offset);offset=owner.end
        if(offset+10>bytes.length)throw new Error('Truncated DNS record')
        const type=view.getUint16(offset),recordClass=view.getUint16(offset+2)&0x7fff,ttl=view.getUint32(offset+4),length=view.getUint16(offset+8)
        offset+=10
        const end=offset+length
        if(end>bytes.length)throw new Error('Truncated DNS record data')
        let value:DnsRecord['value']|undefined
        if(recordClass===1&&type===1&&length===4)value=[...bytes.subarray(offset,end)].join('.')
        if(recordClass===1&&type===33){
            if(length<7)throw new Error('Truncated DNS service')
            const target=readName(bytes,offset+6)
            if(target.end!==end)throw new Error('Invalid DNS service length')
            value={port:view.getUint16(offset+4),target:target.name}
        }
        if(recordClass===1&&type===16){
            const fields:Record<string,string>=Object.create(null)
            while(offset<end){
                const size=bytes[offset++]!
                if(offset+size>end)throw new Error('Truncated DNS TXT field')
                const text=decoder.decode(bytes.subarray(offset,offset+size)),separator=text.indexOf('=')
                offset+=size
                if(separator<1)continue
                const key=text.slice(0,separator).toLowerCase()
                if(Object.hasOwn(fields,key))throw new Error('Duplicate DNS TXT field')
                fields[key]=text.slice(separator+1)
            }
            value=fields
        }
        if(value!==undefined)records.push({name:owner.name,type,value,expiresAt:now+Math.min(ttl,86400)*1000})
        offset=end
    }
    return records
}

/** Accumulates DNS-SD fragments across packets; malformed packets never contribute partial records. */
export class NikonWifiDiscoveryRecords {
    private records=new Map<string,DnsRecord>()
    accept(packet:Uint8Array,now=Date.now()):void{
        let parsed:DnsRecord[]
        try{parsed=parseRecords(packet,now)}catch{return}
        for(const record of parsed){
            const key=`${record.name}:${record.type}`
            if(record.expiresAt<=now)this.records.delete(key)
            else if(this.records.has(key)||this.records.size<4096)this.records.set(key,record)
        }
    }
    cameras(now=Date.now()):NikonWifiAdvertisement[]{
        const found:NikonWifiAdvertisement[]=[]
        for(const record of this.records.values()){
            if(record.type!==33||record.expiresAt<=now||!record.name.endsWith(serviceSuffix)||typeof record.value!=='object'||!('target'in record.value))continue
            const endpoint=record.value as {port:number;target:string}
            const text=this.records.get(`${record.name}:16`),address=this.records.get(`${endpoint.target}:1`)
            if(!text||text.expiresAt<=now||!address||address.expiresAt<=now||typeof address.value!=='string'||typeof text.value!=='object'||endpoint.port===0)continue
            const fields=text.value as Record<string,string>
            if(!['04b0','0x04b0','1200'].includes(fields.vid?.toLowerCase()??''))continue
            const modes:Record<string,NikonWifiAdvertisement['mode']>={_DSC:'camera-control',PAIR:'pairing-required',WT3T:'image-transfer',WT4S:'unsupported',_DPS:'unsupported'}
            const mode=Object.hasOwn(modes,fields.apps??'')?modes[fields.apps!]:undefined
            if(!mode||/^(0\.|127\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(address.value))continue
            const product=fields.pid?.match(/^(?:0x)?[0-9a-f]{1,8}$/i)?.[0]
            found.push({host:address.value,port:endpoint.port,serviceName:record.name,mode,...(product?{usbProductId:product}:{}),controlVerified:false})
        }
        return found.sort((first,second)=>first.serviceName.localeCompare(second.serviceName))
    }
}

/** One bounded, read-only mDNS browse on the chosen IPv4 network interface. */
export async function discoverNikonWifiCameras(options:{localAddress:string;timeoutMilliseconds?:number}):Promise<NikonWifiAdvertisement[]>{
    const timeout=options.timeoutMilliseconds??2000
    const octets=options.localAddress.split('.')
    if(octets.length!==4||octets.some(part=>!/^\d{1,3}$/.test(part)||Number(part)>255)||Number(octets[0])===0||Number(octets[0])>=224)throw new Error('Choose a local unicast IPv4 address for Nikon discovery')
    if(!Number.isFinite(timeout)||timeout<100||timeout>10000)throw new Error('Nikon discovery timeout must be 100–10000 milliseconds')
    const {createSocket}=await import('node:dgram')
    const socket=createSocket({type:'udp4',reuseAddr:true}),records=new NikonWifiDiscoveryRecords()
    return await new Promise((resolve,reject)=>{
        let settled=false
        const finish=(error?:Error)=>{
            if(settled)return
            settled=true;clearTimeout(timer)
            try{socket.close()}catch{ /* A bind failure can leave no socket to close. */ }
            if(error)reject(error);else resolve(records.cameras())
        }
        const timer=setTimeout(()=>finish(),timeout)
        socket.on('error',finish)
        socket.on('message',packet=>records.accept(packet))
        socket.bind(5353,'0.0.0.0',()=>{
            if(settled)return
            try{
                socket.addMembership('224.0.0.251',options.localAddress)
                socket.setMulticastInterface(options.localAddress)
                const labels=['_ptp','_tcp','local'],query=new Uint8Array(12+labels.reduce((size,label)=>size+1+label.length,1)+4)
                query[5]=1
                let offset=12
                for(const label of labels){query[offset++]=label.length;for(const character of label)query[offset++]=character.charCodeAt(0)}
                offset++;query[offset+1]=12;query[offset+3]=1
                socket.send(query,5353,'224.0.0.251',error=>{if(error)finish(error)})
            }catch(error){finish(error instanceof Error?error:new Error(String(error)))}
        })
    })
}
