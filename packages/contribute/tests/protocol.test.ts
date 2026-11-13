import { validateProtocol } from '@darkgrade/contribute/protocol'
import { validateContribution } from '@darkgrade/contribute/schema'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
const descriptor = { type:'descriptor',vendorId:0,property:0x5001,dataType:4,writable:false,current:75,default:100,values:[0,25,50,75,100] }
test('property requests retain outcomes and correlation without accepting private payloads or claiming observed values',()=>{
 const write={type:'property-write',vendorId:0x04a9,property:0xd1b8,dataType:6,requested:4,transactionId:23,outcome:'response',response:0x2019}
 validateProtocol(write)
 validateProtocol({...write,outcome:'error',response:undefined})
 for(const invalid of [
  {...write,property:0xd115}, {...write,requested:'SECRET'}, {...write,requested:0x100000000},
  {...write,transactionId:-1}, {...write,response:undefined}, {...write,outcome:'error'},
  {...write,response:0x10000}, {...write,current:4}, {...write,payload:'SECRET'},
 ])assert.throws(()=>validateProtocol(invalid))
})
test('numeric evidence accepts exact integers and rejects media, identity, unknown values and malformed inventories',()=>{
 validateProtocol(descriptor)
 validateProtocol({...descriptor,dataType:10,current:'18446744073709551615',values:undefined})
 for(const value of [{...descriptor,dataType:2,current:256},{...descriptor,dataType:2,current:-1},{...descriptor,dataType:1,current:128}])assert.throws(()=>validateProtocol(value))
 validateProtocol({type:'unknown',vendorId:0x04b0,category:'property',code:0xdfff,advertised:true})
 for(const value of [ {...descriptor,property:0x5011},{...descriptor,property:0xffff}, {...descriptor,current:'PRIVATE_SERIAL'}, {...descriptor,data:new Uint8Array([1,2])}, {...descriptor,dataType:0xffff}, {...descriptor,current:NaN}, {...descriptor,values:Array(513).fill(1)}, {...descriptor,current:'9'.repeat(40)}, {type:'inventory',vendorId:0,category:'operation',codes:[1,1]}, {type:'inventory',vendorId:0,category:'operation',codes:[65536]} ])assert.throws(()=>validateProtocol(value))
 for(let index=0;index<100;index++)assert.throws(()=>validateProtocol({...descriptor,['payload'+index]:'secret'}))
 const contribution={schema:'darkgrade.diagnostics/v1',disclosure:'protocol-metadata-only/v1',id:randomUUID(),camera:{manufacturer:'Bench',model:'Test',firmware:'1',revision:'abcdef0',dirty:false,transport:'usb',evidence:'synthetic'},entries:[{kind:'data',direction:'in',bytes:0,durationMilliseconds:0,failed:false,protocol:descriptor}],droppedEntries:0}
 validateContribution(contribution)
 assert.throws(()=>validateContribution({...contribution,entries:[{...contribution.entries[0],protocol:{...descriptor,privateKey:'secret'}}]}))
})
