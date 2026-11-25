import {createTelemetry} from '#collector/telemetry'
import {exportMatrixPage} from '#collector/matrix-pages'
import {saveProtocolFinding} from '#collector/protocol-research'
import {admissionLimit} from '#collector/abuse-limits'
import {batch,enroll,memoryDatabase,request} from './telemetry-fixture.ts'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {randomUUID} from 'node:crypto'

test('burst limits are shared, bounded and recover without blocking withdrawal',async()=>{
 const {database}=memoryDatabase();let date=new Date();const options={publicUrl:'https://telemetry.example',now:()=>date,enrollmentBurstLimit:2,uploadBurstLimit:20,installationBurstLimit:2}
 const first=createTelemetry(database,options),second=createTelemetry(database,options),user=await enroll(first)
 await enroll(second);const limited=await first(request('/v2/installations','POST',undefined,{}));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60')
 const payload=batch();assert.equal((await first(request('/v2/batches','POST',user.installKey,payload))).status,202)
 assert.equal((await second(request('/v2/batches','POST',user.installKey,payload))).status,202)
 assert.equal((await first(request('/v2/batches','POST',user.installKey,payload))).status,429)
 assert.equal((await first(request('/v2/installation','DELETE',user.installKey))).status,200)
 date=new Date(+date+60000);await enroll(second)
 const admit=admissionLimit(2,1),release=admit(1);assert.ok(release);assert.equal(admit(1),undefined);release();release();assert.equal(admit(1),undefined);assert.ok(admit(1001))
})
test('profile evidence and referenced findings reach Matrix but never become a hardware pass; withdrawal removes both',async()=>{
 const {database,records}=memoryDatabase(),handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle),payload=batch()
 const context=payload.contributions[0].camera
 Object.assign(payload.contributions[0].entries[0],{protocol:{type:'unknown',vendorId:0x04b0,category:'property',code:0xdfff,advertised:true}})
 assert.equal((await handle(request('/v2/batches','POST',user.installKey,payload))).status,202)
 const sourceRecord=user.installId+'_'+payload.id
 const scope=Object.fromEntries(['manufacturer','model','firmware','revision','transport','evidence'].map(key=>[key,context[key as keyof typeof context]]))
 const finding={scope,category:'property',code:0xdfff,name:'Unresolved test property',summary:'Fixture research, not hardware evidence',status:'documented',references:[{title:'Isolated regression fixture',revision:'abcdef0',locator:'tests/protocol.test.ts'}]}
 await assert.rejects(saveProtocolFinding(database,sourceRecord,{...finding,references:[]}))
 await assert.rejects(saveProtocolFinding(database,sourceRecord,{...finding,scope:{...scope,model:'Wrong camera'}}))
 await saveProtocolFinding(database,sourceRecord,finding)
 const page=await exportMatrixPage(database);const row=page.records.find(r=>r.sourceRecord===sourceRecord)!
 assert.equal(row.hardwarePass,false);assert.equal(row.patterns[0].protocol[0].code,0xdfff);assert.equal(row.findings[0].references[0].revision,'abcdef0')
 const query=page.next;assert.equal(query,null)
 assert.equal((await handle(request('/v2/installation','DELETE',user.installKey))).status,200)
 assert.equal((await exportMatrixPage(database)).records.length,0);assert.ok(!records.has('protocolFindings/'+sourceRecord))
})
test('the Matrix export passes only the evidence types, fields and entry kinds Matrix accepts',async()=>{
 const {database}=memoryDatabase(),handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle),payload=batch()
 const entry=payload.contributions[0].entries[0],benchmarkId=randomUUID(),callId=randomUUID()
 const write={type:'property-write',vendorId:0x04a9,property:0xd11c,dataType:6,requested:2,transactionId:1,outcome:'response',response:0x2001}
 payload.contributions[0].entries=[
  {...entry,kind:'attach',direction:'lifecycle',code:undefined},
  {...entry,kind:'response',direction:'in',code:0x2001,commandCode:0x9110},
  {...entry,protocol:{...write,prior:1,priorAgeMilliseconds:40}},
  {...entry,protocol:{type:'focus-point',vendorId:0x04b0,x:320,y:240,transactionId:2,outcome:'response',response:0x2001}},
  {...entry,protocol:{type:'object-info',vendorId:0x04b0,format:0x3801,size:0xffffffff,captureDate:'20261125T101500',transactionId:3}},
  {...entry,protocol:{type:'transfer',vendorId:0x04b0,offset:0,requestedBytes:1048576,receivedBytes:4096,transactionId:4,outcome:'response',response:0x2002}},
  {...entry,protocol:{type:'warning-status',vendorId:0x04b0,property:0xd102,value:1,flags:['card-full'],operation:0x9207,transactionId:5}},
  {...entry,protocol:{type:'benchmark',benchmarkId,vendorId:0x04a9,status:'complete',checks:2,failures:0,purpose:'first-contact'}},
  {...entry,protocol:{type:'unrecognized-value',vendorId:0x04a9,property:0xd11c,dataType:6,raw:7,choice:true}},
  {...entry,kind:'call',direction:'lifecycle',callId,code:undefined,call:{operation:'getBattery',tool:'camera_get_battery',
   command:'darkgrade camera get-battery',surface:'library',outcome:'ok',attribution:'async-context'}},
 ] as any
 const sent=await handle(request('/v2/batches','POST',user.installKey,payload));assert.equal(sent.status,202,await sent.text())
 const row=(await exportMatrixPage(database)).records.find(r=>r.sourceRecord===user.installId+'_'+payload.id)!
 const pattern=row.patterns[0]
 assert.deepEqual(pattern.protocol,[write,{type:'benchmark',benchmarkId,vendorId:0x04a9,status:'complete',checks:2,failures:0}],
  'a write\'s prior value, benchmark purpose and the newer evidence types are Telemetry-only')
 assert.deepEqual(pattern.observed.map((o:{kind:string})=>o.kind),['response'],'no call or attach entries; evidence entries are not observed rows')
 assert.doesNotMatch(JSON.stringify(row),/commandCode|prior|focus-point|object-info|warning-status|"transfer"|unrecognized|attach/)
 assert.equal((await handle(request('/v2/installation','DELETE',user.installKey))).status,200)
})
