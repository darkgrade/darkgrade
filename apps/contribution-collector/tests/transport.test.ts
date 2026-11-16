import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cameraConnection } from '#collector/transport'
import { camera } from './telemetry-fixture.ts'
test('connection labels keep named vendor calls separate from native PTP without rewriting source objects',()=>{
 const legacy={...camera,manufacturer:'Sony',transport:'sony-sdk' as const}
 const saved=JSON.stringify(legacy)
 const entry={kind:'command' as const,direction:'out' as const,code:null,bytes:0,durationMilliseconds:0,failed:false,operation:'properties'}
 assert.deepEqual(cameraConnection(legacy,[entry]),{...legacy,transport:'unknown',backend:'vendor-api'})
 assert.equal(cameraConnection({...camera,transport:'usb'},[entry]).backend,'vendor-api')
 assert.equal(cameraConnection(legacy,[{...entry,operation:'connect_wifi'}]).transport,'wifi')
 assert.equal(cameraConnection({...camera,backend:'ptp'},[]).backend,'ptp')
 assert.equal(JSON.stringify(legacy),saved)
})
