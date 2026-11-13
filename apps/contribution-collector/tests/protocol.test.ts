import {createTelemetry} from '#collector/telemetry'
import {exportMatrixPage} from '#collector/matrix-pages'
import {saveProtocolFinding} from '#collector/protocol-research'
import {admissionLimit} from '#collector/abuse-limits'
import {batch,enroll,memoryDatabase,request} from './telemetry-fixture.ts'
import assert from 'node:assert/strict'
import {test} from 'node:test'

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
