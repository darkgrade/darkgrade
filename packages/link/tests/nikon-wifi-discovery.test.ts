import {describe,expect,it} from 'vitest'
import {discoverNikonWifiCameras,NikonWifiDiscoveryRecords} from '@vendors/nikon/wifi-discovery'

const instance='Z6III-camera._ptp._tcp.local',host='Z6III-camera.local'
interface RecordInput {name:string;type:number;data:number[]|((encode:(name:string)=>number[])=>number[]);ttl?:number}
const integer=(value:number,size:number)=>Array.from({length:size},(_,index)=>(value>>>((size-index-1)*8))&255)
function packet(records:RecordInput[],compressed=true){
    const bytes=[0,0,0x84,0,0,0,...integer(records.length,2),0,0,0,0],names=new Map<string,number>()
    const encode=(name:string):number[]=>{
        const previous=names.get(name)
        if(compressed&&previous!==undefined)return [0xc0|(previous>>>8),previous&255]
        names.set(name,bytes.length)
        return [...name.split('.').flatMap(label=>[label.length,...Buffer.from(label)]),0]
    }
    for(const record of records){
        bytes.push(...encode(record.name),...integer(record.type,2),0x80,1,...integer(record.ttl??120,4),0,0)
        const lengthIndex=bytes.length-2,data=typeof record.data==='function'?record.data(encode):record.data
        bytes[lengthIndex]=(data.length>>>8)&255;bytes[lengthIndex+1]=data.length&255;bytes.push(...data)
    }
    return new Uint8Array(bytes)
}
const txt=(fields:Record<string,string>)=>Object.entries(fields).flatMap(([key,value])=>{const bytes=[...Buffer.from(`${key}=${value}`)];return [bytes.length,...bytes]})
function advertisement(options:{vendor?:string;apps?:string;port?:number;ttl?:number;product?:string}={}){
    return [
        {name:host,type:1,data:[192,168,1,60],ttl:options.ttl},
        {name:instance,type:33,data:(encode:(name:string)=>number[])=>[0,0,0,0,...integer(options.port??15740,2),...encode(host)],ttl:options.ttl},
        {name:instance,type:16,data:txt({vid:options.vendor??'A',pid:options.product??'0x0458',apps:options.apps??'$DSC',guid:'private-camera-identifier',seq:'10',ver:'1'}),ttl:options.ttl},
    ] satisfies RecordInput[]
}

describe('Nikon Bonjour advertisements',()=>{
    it('parses compressed SRV/TXT/A records without presenting an advertisement as verified control',()=>{
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement()))
        expect(records.cameras()).toEqual([{host:'192.168.1.60',port:15740,serviceName:instance.toLowerCase(),mode:'camera-control',usbProductId:'0x0458',controlVerified:false}])
        expect(JSON.stringify(records.cameras())).not.toMatch(/private-camera-identifier|guid|seq/)
    })
    it('assembles TXT/SRV/A answers arriving in separate packets in any order',()=>{
        const records=new NikonWifiDiscoveryRecords(),answers=advertisement()
        for(const record of [answers[2]!,answers[1]!,answers[0]!])records.accept(packet([record]))
        expect(records.cameras()).toHaveLength(1)
    })
    it.each([['A',true],['a',true],['04b0',true],['0x04b0',true],['1200',true],['04B0',true],['04a9',false],['Nikon',false],['',false]])('requires Nikon VID %s', (vendor,accepted)=>{
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement({vendor})))
        expect(records.cameras()).toHaveLength(accepted?1:0)
    })
    it.each([['$DSC','camera-control'],['PAIR','pairing-required'],['WT3T','image-transfer'],['WT4S','unsupported'],['$DPS','unsupported'],['_DSC',undefined],['_DPS',undefined],['UNKNOWN',undefined],['__proto__',undefined]])('classifies exact apps=%s without guessing',(apps,mode)=>{
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement({apps})))
        expect(records.cameras()[0]?.mode).toBe(mode)
    })
    it('ignores truncated packets atomically, including an earlier otherwise valid A record',()=>{
        const full=packet(advertisement())
        for(const length of [0,11,30,full.length-1]){
            const records=new NikonWifiDiscoveryRecords();records.accept(full.subarray(0,length));records.accept(packet(advertisement().slice(1)))
            expect(records.cameras()).toEqual([])
        }
    })
    it('bounds cyclic and out-of-range compressed names',()=>{
        for(const pointer of [[0xc0,12],[0xff,0xff]]){
            const bytes=new Uint8Array([0,0,0x84,0,0,0,0,1,0,0,0,0,...pointer,0,1,0,1,0,0,0,120,0,4,192,168,1,60])
            const records=new NikonWifiDiscoveryRecords();records.accept(bytes)
            expect(records.cameras()).toEqual([])
        }
    })
    it('does not combine unrelated services or non-Nikon identities into a camera',()=>{
        const records=new NikonWifiDiscoveryRecords(),answers=advertisement()
        answers[2]!.name='Other-camera._ptp._tcp.local'
        records.accept(packet(answers));expect(records.cameras()).toEqual([])
    })
    it('expires records and honors goodbye TTL=0',()=>{
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement({ttl:1})),1000)
        expect(records.cameras(1500)).toHaveLength(1);expect(records.cameras(2000)).toEqual([])
        records.accept(packet(advertisement()),3000);records.accept(packet([advertisement({ttl:0})[2]!]),3500)
        expect(records.cameras(3500)).toEqual([])
    })
    it('rejects invalid TXT lengths, duplicate keys, zero ports and non-PTP services',()=>{
        for(const change of [(r:RecordInput[])=>r[2]!.data=[255,1],(r:RecordInput[])=>r[2]!.data=[...txt({vid:'04b0'}),...txt({vid:'04b0',apps:'$DSC'})],(r:RecordInput[])=>r[1]!.name='printer._ipp._tcp.local']){
            const records=new NikonWifiDiscoveryRecords(),answers=advertisement();change(answers);records.accept(packet(answers));expect(records.cameras()).toEqual([])
        }
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement({port:0})));expect(records.cameras()).toEqual([])
    })
    it('preserves ambiguous decimal-looking PID strings without asserting a product identity',()=>{
        const records=new NikonWifiDiscoveryRecords();records.accept(packet(advertisement({product:'1564'})))
        expect(records.cameras()[0]?.usbProductId).toBe('1564')
    })
    it('validates network bounds before opening a socket',async()=>{
        for(const localAddress of ['','hostname','999.1.2.3','224.0.0.1','0.0.0.0'])await expect(discoverNikonWifiCameras({localAddress})).rejects.toThrow('IPv4')
        for(const timeoutMilliseconds of [0,99,10001,Infinity,NaN])await expect(discoverNikonWifiCameras({localAddress:'192.168.1.2',timeoutMilliseconds})).rejects.toThrow('timeout')
    })
})
