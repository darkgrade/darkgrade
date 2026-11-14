import { investigate } from '#collector/investigate'
import { operatorApi } from '#collector/operator'
import { postgresDatabase } from '#collector/postgres'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { createTelemetry } from '#collector/telemetry'
import { NOTICE_VERSION } from '@darkgrade/contribute/batch'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { batch, enroll, request } from './telemetry-fixture.ts'
import { Pool } from 'pg'

test('legacy transport migration keeps query labels and Matrix projections consistent without rewriting signed source data', {skip:!process.env.DATABASE_URL}, async()=>{
    let database=await postgresDatabase(process.env.DATABASE_URL!)
    const handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle)
    const pool=new Pool({connectionString:process.env.DATABASE_URL!})
    try{
        const payload=batch(),contribution=payload.contributions[0],entry=contribution.entries[0]
        Object.assign(contribution.camera,{manufacturer:'Sony',model:'ILCE-6700',transport:'sony-sdk'})
        contribution.entries=[{...entry,kind:'command',code:undefined,operation:'connect_wifi'},{...entry,kind:'command',code:undefined,operation:'properties'}] as any
        const uploaded=await handle(request('/v2/batches','POST',user.installKey,payload))
        assert.equal(uploaded.status,202,await uploaded.text())
        const source=await database.get(`diagnostics/${user.installId}_${payload.id}`)
        await pool.query(`UPDATE telemetry_events SET transport='sony-sdk',backend='unknown',connection_normalized=false WHERE installation_id=$1`,[user.installId])
        await database.close();database=await postgresDatabase(process.env.DATABASE_URL!)
        // Startup is independent of historical backfill. Maintenance resumes after a
        // rollout and catches a late write from an old collector instance as well.
        assert.equal((await database.operator.report({days:1,installation:user.installId})).events[0].transport,'sony-sdk')
        assert.equal(await database.normalizeConnections(),2)
        assert.equal(await database.normalizeConnections(),0)
        await pool.query(`UPDATE telemetry_events SET transport='sony-sdk',backend='unknown',connection_normalized=false WHERE installation_id=$1`,[user.installId])
        assert.equal(await database.normalizeConnections(),2)
        const report=await database.operator.report({days:1,installation:user.installId})
        assert.equal(report.events.length,2)
        assert.ok(report.events.every(event=>event.transport==='wifi'&&event.backend==='vendor-api'))
        assert.equal((await database.get(`diagnostics/${user.installId}_${payload.id}`))?.payload,source?.payload)
        const {exportMatrixPage}=await import('#collector/matrix-pages')
        const page=await exportMatrixPage(database)
        assert.ok(page.records.find(row=>row.installId===user.installId)?.patterns.every(pattern=>pattern.camera.transport==='wifi'))
    }finally{
        await createTelemetry(database,{publicUrl:'https://telemetry.example'})(request('/v2/installation','DELETE',user.installKey))
        await database.close();await pool.end()
    }
})

test('Matrix pages use a bounded database snapshot and preserve watermark, review, credit and withdrawal', {skip:!process.env.DATABASE_URL},async()=>{
    const {exportMatrixPage,MatrixExportChanged}=await import('#collector/matrix-pages')
    const database=await postgresDatabase(process.env.DATABASE_URL!)
    const handle=createTelemetry(database,{publicUrl:'https://telemetry.example'})
    const user=await enroll(handle)
    const sourceIds:string[]=[]
    try{
        for(let i=0;i<105;i++){
            const payload=batch()
            assert.equal((await handle(request('/v2/batches','POST',user.installKey,payload))).status,202)
            sourceIds.push(`${user.installId}_${payload.id}`)
        }
        await reviewDiagnostic(database,sourceIds[0])
        await database.transaction(async tx=>tx.set(`contacts/${user.installId}`,{
            confirmedAt:new Date(),email:'private@example.com',credit:{name:'Source contributor',publish:true},
        }))
        const now=new Date()
        // Match the transactional implementation exactly, including dates and source references.
        const first=await exportMatrixPage(database,undefined,now)
        const fallback={...database,matrixSources:undefined}
        assert.deepEqual(first,await exportMatrixPage(fallback,undefined,now))
        const originalTransaction=database.transaction
        database.transaction=async()=>{throw Error('Page export must not open per-record transactions')}
        let page
        try{page=await exportMatrixPage(database,undefined,now)}
        finally{database.transaction=originalTransaction}
        const later=batch()
        assert.equal((await handle(request('/v2/batches','POST',user.installKey,later))).status,202)
        const records=[...page.records]
        while(page.next){page=await exportMatrixPage(database,page.next,now);records.push(...page.records)}
        const own=records.filter(r=>r.installId===user.installId)
        assert.equal(own.length,105)
        assert.ok(own.every(r=>r.hardwarePass===false&&r.credit.name==='Source contributor'))
        assert.equal(own.filter(r=>r.reviewedAt!==null).length,1)
        assert.doesNotMatch(JSON.stringify(own),/private@example|keyHash|installKey/)
        assert.ok(first.next)
        assert.equal((await handle(request('/v2/contact','DELETE',user.installKey))).status,200)
        await assert.rejects(exportMatrixPage(database,first.next!),MatrixExportChanged)
        await handle(request('/v2/installation','DELETE',user.installKey))
        let removed=await exportMatrixPage(database)
        do{
            assert.ok(!removed.records.some(r=>r.installId===user.installId))
            if(!removed.next)break
            removed=await exportMatrixPage(database,removed.next)
        }while(true)
    }finally{
        await handle(request('/v2/installation','DELETE',user.installKey))
        await database.close()
    }
})

test(
    'session lists page across tied timestamps and review queues omit reviewed and withdrawn sources',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const database = await postgresDatabase(process.env.DATABASE_URL!)
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        const user = await enroll(handle),
            payload = batch(),
            entry = payload.contributions[0].entries[0]
        payload.contributions[0].entries = Array.from({ length: 111 }, () => ({
            ...entry,
            sessionId: randomUUID(),
            occurredAt: new Date().toISOString(),
        }))
        try {
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, payload))).status, 202)
            const first = await database.operator.report({ days: 1, installation: user.installId })
            assert.equal(first.sessions.length, 100)
            assert.ok(first.sessionsNext)
            const after = JSON.parse(Buffer.from(first.sessionsNext!, 'base64url').toString())
            const last = await database.operator.report({ days: 1, installation: user.installId, after })
            assert.equal(last.sessions.length, 11)
            assert.equal(last.sessionsNext, null)
            assert.equal(new Set([...first.sessions, ...last.sessions].map(row => row.session_id)).size, 111)
            const suggestions = await database.operator.suggestions('session', '', {
                days: 1,
                installation: user.installId,
            })
            assert.equal(suggestions.items.length, 20)
            assert.equal(suggestions.more, true)
            const olderId = last.sessions[0].session_id
            const older = await database.operator.suggestions('session', olderId, {
                days: 1,
                installation: user.installId,
            })
            assert.equal(older.items[0].value, olderId, 'typeahead searches beyond the first report page')
            assert.equal(older.items[0].installation, user.installId)
            assert.deepEqual(older.items[0].evidence, ['synthetic'])
            assert.equal(
                (await database.operator.suggestions('session', olderId, { days: 1, installation: randomUUID() })).items
                    .length,
                0
            )
            assert.equal(
                (await database.operator.suggestions('model', '%', { days: 1, installation: user.installId })).items
                    .length,
                0
            )
            const path = `diagnostics/${user.installId}_${payload.id}`
            let queue = await database.operator.reviewQueue()
            for (let count = 0; !queue.items.some(row => row.path === path) && queue.next && count < 10; count++)
                queue = await database.operator.reviewQueue(queue.next)
            assert.ok(queue.items.some(row => row.path === path))
            await reviewDiagnostic(database, `${user.installId}_${payload.id}`)
            assert.ok(!(await database.operator.reviewQueue()).items.some(row => row.path === path))
        } finally {
            await handle(request('/v2/installation', 'DELETE', user.installKey))
            await database.close()
        }
    }
)

test(
    'operator API scopes issues, guards mutations, preserves provenance and revokes uploads',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const database = await postgresDatabase(process.env.DATABASE_URL!)
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        const user = await enroll(handle)
        const key = 'operator-key-'.padEnd(40, 'x')
        const admin = (path: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) =>
            new Request('https://telemetry.example/internal/api' + path, {
                method,
                headers: {
                    authorization: `Basic ${Buffer.from(`outpost:${key}`).toString('base64')}`,
                    'content-type': 'application/json',
                    'x-darkgrade-operator': '1',
                    ...extra,
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            })
        try {
            const payload = batch()
            payload.contributions[0].entries[0].failed = true
            await handle(request('/v2/batches', 'POST', user.installKey, payload))
            const report = await operatorApi(admin('/report?installation=' + user.installId), key, database)
            assert.equal(report.status, 200)
            const results = await report.json()
            assert.equal(results.summary.events, 1)
            assert.equal(results.summary.errors, 1)
            assert.equal(results.issues.length, 1)
            assert.equal(results.events[0].installation_id, user.installId)
            const lean = await (await operatorApi(admin('/report?installation=' + user.installId + '&includeEvents=false'), key, database)).json()
            assert.deepEqual(lean.events, [])
            assert.equal(lean.eventLimit, 0)
            assert.deepEqual(lean.summary, results.summary)
            assert.deepEqual(lean.sessions, results.sessions)
            assert.equal((await operatorApi(admin('/report?includeEvents=maybe'), key, database)).status, 400)

            const suggestions = await (
                await operatorApi(admin('/suggestions?field=model&installation=' + user.installId), key, database)
            ).json()
            assert.equal(suggestions.items[0].value, payload.contributions[0].camera.model)
            const manufacturer = payload.contributions[0].camera.manufacturer
            assert.equal(
                (await database.operator.suggestions('model', manufacturer, { days: 1, installation: user.installId }))
                    .items.length,
                1
            )
            assert.equal(
                (
                    await database.operator.suggestions(
                        'model',
                        manufacturer + ' ' + payload.contributions[0].camera.model,
                        { days: 1, installation: user.installId }
                    )
                ).items.length,
                1
            )
            assert.doesNotMatch(JSON.stringify(suggestions), /keyHash|installKey|email|credential/)
            for (const query of [
                'field=keyHash',
                'field=session&installation=bad',
                'field=model&q=' + 'x'.repeat(101),
                'field=revision&transport=bad',
            ]) {
                assert.equal((await operatorApi(admin('/suggestions?' + query), key, database)).status, 400)
            }
            const installations = await (
                await operatorApi(admin('/installations?installation=' + user.installId), key, database)
            ).json()
            assert.equal(installations.items.length, 1)
            assert.doesNotMatch(JSON.stringify(installations), /keyHash|installKey|email|credential/)
            assert.equal((await operatorApi(admin('/report?days=0'), key, database)).status, 400)
            assert.equal((await operatorApi(admin('/report?session=invalid'), key, database)).status, 400)
            assert.equal((await operatorApi(admin('/report?days=1&days=7'), key, database)).status, 400)
            assert.equal(
                (await operatorApi(admin('/report', 'GET', undefined, { authorization: '' }), key, database)).status,
                401
            )
            const sourceRecord = `${user.installId}_${payload.id}`
            assert.equal(
                (
                    await operatorApi(
                        admin('/review', 'POST', { sourceRecord }, { origin: 'https://evil.example' }),
                        key,
                        database
                    )
                ).status,
                403
            )
            assert.equal((await operatorApi(admin('/review', 'POST', { sourceRecord }), key, database)).status, 200)
            const exported = await (await operatorApi(admin('/matrix'), key, database)).json()
            assert.ok(exported.records.some((item: any) => item.sourceRecord === sourceRecord && item.sourceHash))
            assert.equal(
                (
                    await operatorApi(
                        admin('/installations/' + user.installId, 'DELETE', { confirm: randomUUID() }),
                        key,
                        database
                    )
                ).status,
                400
            )
            const removed = await operatorApi(
                admin('/installations/' + user.installId, 'DELETE', { confirm: user.installId }),
                key,
                database
            )
            assert.equal(removed.status, 200)
            assert.equal((await removed.json()).deletionPending, false)
            assert.ok(
                !(await database.operator.installations()).items.some(item => item.id === user.installId),
                'fully deleted installations do not clutter the live list'
            )
            assert.equal(
                (await database.operator.installations(undefined, user.installId)).items[0].revoked,
                true,
                'an exact lookup still verifies revocation'
            )
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, batch()))).status, 410)
            assert.equal(
                (await database.operator.suggestions('installation', user.installId, { days: 90 })).items.length,
                0
            )
            const refreshed = await (await operatorApi(admin('/matrix'), key, database)).json()
            assert.ok(!refreshed.records.some((item: any) => item.sourceRecord === sourceRecord))
        } finally {
            await handle(request('/v2/installation', 'DELETE', user.installKey))
            await database.close()
        }
    }
)

test(
    'real Postgres: atomic retries, timeline, review, withdrawal race and expiry',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const database = await postgresDatabase(process.env.DATABASE_URL!)
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        try {
            const user = await enroll(handle)
            const payload = batch()
            payload.contributions[0].entries[0] = {
                ...payload.contributions[0].entries[0],
                ...{ sessionId: randomUUID(), occurredAt: new Date().toISOString(), transactionId: 123 },
            }
            const results = await Promise.all(
                Array.from({ length: 5 }, () => handle(request('/v2/batches', 'POST', user.installKey, payload)))
            )
            assert.ok(results.every(result => result.status === 202))
            assert.equal((await database.timeline({ installation: user.installId })).length, 1)
            const source = `${user.installId}_${payload.id}`
            await reviewDiagnostic(database, source)
            assert.ok((await exportReviewedPatterns(database)).records.some(row => row.sourceRecord === source))
            const conflict = structuredClone(payload)
            conflict.contributions[0].entries[0].failed = true
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, conflict))).status, 409)

            const key = 'operator-'.padEnd(40, 'x')
            assert.equal(
                (await investigate(new Request('https://telemetry.example/internal'), key, database.timeline)).status,
                401
            )
            const timeline = await investigate(
                new Request(`https://telemetry.example/internal/events?installation=${user.installId}`, {
                    headers: { authorization: `Basic ${Buffer.from(`outpost:${key}`).toString('base64')}` },
                }),
                key,
                database.timeline
            )
            assert.equal(timeline.status, 200)
            const text = await timeline.text()
            assert.ok(text.includes('transactionId'))
            assert.doesNotMatch(text, /keyHash|installKey|email|PRIVATE/)

            await Promise.all([
                handle(request('/v2/batches', 'POST', user.installKey, batch())),
                handle(request('/v2/installation', 'DELETE', user.installKey)),
            ])
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, batch()))).status, 410)
            assert.equal((await database.timeline({ installation: user.installId })).length, 0)
            assert.ok(!(await exportReviewedPatterns(database)).records.some(row => row.sourceRecord === source))

            const another = await enroll(handle)
            const old = batch()
            old.contributions[0].entries = Array.from({ length: 1000 }, () => ({
                ...old.contributions[0].entries[0],
            }))
            await handle(request('/v2/batches', 'POST', another.installKey, old))
            assert.equal((await database.timeline({ installation: another.installId })).length, 500)
            await database.transaction(async transaction => {
                const path = `diagnostics/${another.installId}_${old.id}`
                transaction.set(path, { ...(await transaction.get(path))!, expiresAt: new Date(0) })
            })
            await database.expire()
            assert.equal((await database.timeline({ installation: another.installId })).length, 0)
            await handle(request('/v2/installation', 'DELETE', another.installKey))
        } finally {
            await database.close()
        }
    }
)

test(
    'local identity enrollment is idempotent and deletion defeats delayed enrollment',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const database = await postgresDatabase(process.env.DATABASE_URL!)
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        const installId = randomUUID(),
            installKey = `dgi_${installId}.${randomBytes(32).toString('base64url')}`
        const register = () =>
            handle(request('/v2/installations', 'POST', undefined, { noticeVersion: NOTICE_VERSION, installKey }))
        try {
            const responses = await Promise.all([register(), register()])
            assert.ok(responses.every(response => response.status === 201))
            for (const response of responses) assert.equal((await response.json()).installKey, installKey)
            assert.equal((await handle(request('/v2/installation', 'DELETE', installKey))).status, 200)
            assert.equal((await register()).status, 410)
            const pending = `dgi_${randomUUID()}.${randomBytes(32).toString('base64url')}`
            assert.equal((await handle(request('/v2/installation', 'DELETE', pending))).status, 200)
            assert.equal(
                (
                    await handle(
                        request('/v2/installations', 'POST', undefined, {
                            noticeVersion: NOTICE_VERSION,
                            installKey: pending,
                        })
                    )
                ).status,
                410
            )
        } finally {
            await database.close()
        }
    }
)

test(
    'session replay pages retain chronological ties and enforce installation scope',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const database = await postgresDatabase(process.env.DATABASE_URL!),
            handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' }),
            user = await enroll(handle),
            session = randomUUID(),
            key = 'replay-operator-'.padEnd(40, 'x')
        const admin = (query: string) =>
            new Request('https://telemetry.example/internal/api' + query, {
                headers: { authorization: 'Basic ' + Buffer.from('outpost:' + key).toString('base64') },
            })
        try {
            const payload = batch(),
                entry = payload.contributions[0].entries[0]
            payload.contributions[0].entries = Array.from({ length: 502 }, (_, index) => ({
                ...entry,
                sessionId: session,
                transactionId: index,
                occurredAt: new Date().toISOString(),
                operation: index === 0 ? 'record_start' : index === 501 ? 'record_stop' : 'properties',
            }))
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, payload))).status, 202)
            const report = await (
                await operatorApi(admin('/report?installation=' + user.installId), key, database)
            ).json()
            assert.equal(report.sessions.length, 1)
            assert.equal(report.sessions[0].events, 502)
            const path = '/session?installation=' + user.installId + '&session=' + session
            const first = await (await operatorApi(admin(path), key, database)).json()
            assert.equal(first.events.length, 500)
            assert.ok(first.next)
            const second = await (await operatorApi(admin(path + '&after=' + first.next), key, database)).json()
            assert.equal(second.events.length, 2)
            assert.equal(second.next, null)
            assert.equal(
                new Set([...first.events, ...second.events].map(event => event.batch_path + ':' + event.sequence)).size,
                502
            )
            assert.equal(first.events[0].properties.operation, 'record_start')
            assert.equal(second.events.at(-1).properties.operation, 'record_stop')
            assert.equal((await operatorApi(admin(path + '&after=not-a-cursor'), key, database)).status, 400)
            assert.equal((await operatorApi(admin('/session?session=' + session), key, database)).status, 400)
            const empty = await (
                await operatorApi(admin('/session?installation=' + randomUUID() + '&session=' + session), key, database)
            ).json()
            assert.equal(empty.events.length, 0)
            await handle(request('/v2/installation', 'DELETE', user.installKey))
            assert.equal((await (await operatorApi(admin(path), key, database)).json()).events.length, 0)
        } finally {
            await handle(request('/v2/installation', 'DELETE', user.installKey))
            await database.close()
        }
    }
)

test(
    'real Postgres indexes a body across installations, sessions and Matrix without leaking its serial',
    { skip: !process.env.DATABASE_URL },
    async () => {
        const { exportMatrixPage } = await import('#collector/matrix-pages')
        const { cameraHardwareFingerprint } = await import('@darkgrade/contribute/schema')
        const database = await postgresDatabase(process.env.DATABASE_URL!)
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        const users = await Promise.all([enroll(handle), enroll(handle)])
        const fingerprint = await cameraHardwareFingerprint({
            manufacturer: 'Nikon',
            model: 'Z5_2',
            serialNumber: 'PRIVATE-123',
        })
        try {
            await Promise.all(
                users.map(async user => {
                    const payload = batch()
                    Object.assign(payload.contributions[0].camera, {
                        evidence: 'hardware',
                        hardwareFingerprint: fingerprint,
                    })
                    Object.assign(payload.contributions[0].entries[0], { sessionId: randomUUID(), failed: true })
                    assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, payload))).status, 202)
                })
            )
            const report = await database.operator.report({ days: 1, hardware: fingerprint })
            assert.equal(report.summary.events, 2)
            assert.equal(report.summary.installations, 2)
            assert.equal(report.sessions.length, 2)
            assert.ok(report.sessions.every(s => s.hardware_fingerprints[0] === fingerprint))
            assert.equal(report.issues[0].hardware_fingerprint, fingerprint)
            const choices = await database.operator.suggestions('hardware', fingerprint!.slice(0, 20), { days: 1 })
            assert.equal(choices.items[0].value, fingerprint)
            assert.equal(choices.items[0].installations, 2)
            const session = await database.operator.session(
                report.sessions[0].installation_id,
                report.sessions[0].session_id
            )
            assert.equal(session.events[0].hardware_fingerprint, fingerprint)
            let page = await exportMatrixPage(database)
            const records = [...page.records]
            while (page.next) {
                page = await exportMatrixPage(database, page.next)
                records.push(...page.records)
            }
            const own = records.filter(r => users.some(u => u.installId === r.installId))
            assert.equal(own.length, 2)
            assert.ok(own.every(r => r.reviewedAt === null && r.patterns[0].camera.hardwareFingerprint === fingerprint))
            assert.doesNotMatch(JSON.stringify({ report, choices, own }), /PRIVATE-123/)
            await handle(request('/v2/installation', 'DELETE', users[0].installKey))
            assert.equal((await database.operator.report({ days: 1, hardware: fingerprint })).summary.events, 1)
        } finally {
            for (const user of users) await handle(request('/v2/installation', 'DELETE', user.installKey))
            await database.close()
        }
    }
)

test('deep profiles and unknown-code queues retain scopes and source references in real Postgres', {skip:!process.env.DATABASE_URL},async()=>{
 const database=await postgresDatabase(process.env.DATABASE_URL!),handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle),payload=batch(),benchmark=randomUUID()
 const entry=payload.contributions[0].entries[0]
 Object.assign(entry,{protocol:{type:'unknown',benchmarkId:benchmark,vendorId:0x04b0,category:'property',code:0xdfff,advertised:true}})
 const other=structuredClone(entry);Object.assign(other,{protocol:{type:'inventory',benchmarkId:benchmark,vendorId:0x04b0,category:'operation',codes:[0x1001,0x9fff]}})
 payload.contributions[0].entries.push(other)
 const write=structuredClone(entry)
 Object.assign(write,{kind:'command',direction:'out',failed:true,transactionId:23,
  protocol:{type:'property-write',benchmarkId:benchmark,vendorId:0x04a9,property:0xd1b8,
   dataType:6,requested:4,transactionId:23,outcome:'response',response:0x2019}})
 payload.contributions[0].entries.push(write)
 try {
  assert.equal((await handle(request('/v2/batches','POST',user.installKey,payload))).status,202)
  const queue=await database.operator.protocol({days:1,installation:user.installId})
  assert.equal(queue.items.length,1);assert.equal(Number(queue.items[0].code),0xdfff);assert.equal(queue.items[0].evidence,'synthetic')
  assert.equal(queue.items[0].source,'diagnostics/'+user.installId+'_'+payload.id)
  assert.equal((await database.operator.protocol({days:1,installation:user.installId},queue.items[0].key)).items.length,0)
  const profile=await database.operator.profile(user.installId,benchmark);assert.equal(profile.items.length,3);assert.equal(profile.hardwarePass,false)
  assert.deepEqual(profile.items.find(item=>item.protocol.type==='property-write')?.protocol,write.protocol)
  assert.equal((await database.operator.profile(randomUUID(),benchmark)).items.length,0)
  const lossy=batch(),lossyBenchmark=randomUUID()
  lossy.contributions[0].droppedEntries=1
  Object.assign(lossy.contributions[0].entries[0],{protocol:{type:'benchmark',benchmarkId:lossyBenchmark,vendorId:0x04b0,status:'complete',checks:1,failures:0}})
  await handle(request('/v2/batches','POST',user.installKey,lossy))
  assert.equal((await database.operator.profile(user.installId,lossyBenchmark)).truncated,true)
  const sourcePath='diagnostics/'+user.installId+'_'+payload.id
  let original: any
  await database.transaction(async transaction=>{
    original=await transaction.get(sourcePath)
    transaction.set(sourcePath,{...original,expiresAt:new Date(0)})
  })
  assert.equal((await database.operator.profile(user.installId,benchmark)).items.length,0)
  assert.equal((await database.operator.protocol({days:1,installation:user.installId})).items.length,0)
  await database.transaction(async transaction=>{
    transaction.set(sourcePath,original)
    const path='installations/'+user.installId
    transaction.set(path,{...await transaction.get(path),revoked:true})
  })
  assert.equal((await database.operator.profile(user.installId,benchmark)).items.length,0)
  assert.equal((await database.operator.protocol({days:1,installation:user.installId})).items.length,0)
  await handle(request('/v2/installation','DELETE',user.installKey))
  assert.equal((await database.operator.protocol({days:1,installation:user.installId})).items.length,0)
 } finally {await handle(request('/v2/installation','DELETE',user.installKey));await database.close()}
})

test('observed camera snapshots survive Postgres replay and Matrix independently of requested writes', {skip:!process.env.DATABASE_URL}, async()=>{
 const database=await postgresDatabase(process.env.DATABASE_URL!),handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle),payload=batch(),session=randomUUID()
 const snapshot={type:'state-snapshot',vendorId:0x04a9,workflow:'recording',phase:'after-prepare',basis:'observed-cache',settings:[{property:0xd1c2,dataType:6,current:0,ageMilliseconds:450}]}
 const benchmarkId=randomUUID(),initial={...snapshot,workflow:'benchmark',phase:'before-prepare',benchmarkId}
 payload.contributions[0].camera.manufacturer='Canon'
 payload.contributions[0].entries=[
  {...payload.contributions[0].entries[0],kind:'data',sessionId:session,protocol:snapshot},
  {...payload.contributions[0].entries[0],kind:'command',sessionId:session,protocol:{type:'property-write',vendorId:0x04a9,property:0xd11c,dataType:6,requested:2,transactionId:1,outcome:'response',response:0x2001}},
  {...payload.contributions[0].entries[0],kind:'data',sessionId:session,protocol:initial},
 ] as any
 try{
  assert.equal((await handle(request('/v2/batches','POST',user.installKey,payload))).status,202)
  const replay=await database.operator.session(user.installId,session)
  assert.deepEqual(replay.events[0].properties.protocol,snapshot)
  const {exportMatrixPage}=await import('#collector/matrix-pages'),page=await exportMatrixPage(database)
  const row=page.records.find(row=>row.sourceRecord===user.installId+'_'+payload.id)
  assert.ok(row);assert.equal(page.hardwarePass,false)
  const evidence=row.patterns.flatMap((pattern:any)=>pattern.protocol||[])
  assert.deepEqual(evidence.find((entry:any)=>entry.type==='state-snapshot'),snapshot)
  assert.equal(evidence.find((entry:any)=>entry.type==='property-write').requested,2)
  assert.deepEqual(evidence.find((entry:any)=>entry.workflow==='benchmark'),initial)
  const profile=await database.operator.profile(user.installId,benchmarkId)
  assert.deepEqual(profile.items[0].protocol,initial)
 }finally{await handle(request('/v2/installation','DELETE',user.installKey));await database.close()}
})

test('signal search and every session sort paginate tied values without losing sessions', {skip:!process.env.DATABASE_URL}, async()=>{
    const database=await postgresDatabase(process.env.DATABASE_URL!),handle=createTelemetry(database,{publicUrl:'https://telemetry.example'}),user=await enroll(handle)
    try{
        const payload=batch(),entry=payload.contributions[0].entries[0]
        payload.contributions[0].entries=Array.from({length:111},(_,index)=>{
            const sessionId=randomUUID()
            return Array.from({length:1+index%3},(_,ordinal)=>({...entry,sessionId,kind:'response',direction:'in',code:index%2?0x2001:0x2019,failed:false,occurredAt:new Date(Date.now()-10000+ordinal*100).toISOString()}))
        }).flat()
        assert.equal((await handle(request('/v2/batches','POST',user.installKey,payload))).status,202)
        for(const sort of ['recent','signals','events','duration','camera'] as const)for(const direction of ['asc','desc'] as const){
            const filters={days:1,installation:user.installId,includeEvents:false,sort,direction}
            const first=await database.operator.report(filters)
            assert.equal(first.sessions.length,100)
            const after=JSON.parse(Buffer.from(first.sessionsNext!,'base64url').toString())
            const last=await database.operator.report({...filters,after})
            assert.equal(last.sessions.length,11,sort+' '+direction)
            assert.equal(new Set([...first.sessions,...last.sessions].map(s=>s.session_id)).size,111)
            await assert.rejects(database.operator.report({...filters,direction:direction==='asc'?'desc':'asc',after}),/different sort/)
        }
        const suggested=await database.operator.suggestions('signal','busy',{days:1,installation:user.installId})
        assert.equal(suggested.items[0].value,'response:0x2019');assert.match(suggested.items[0].label,/Device busy/)
        const filtered=await database.operator.report({days:1,installation:user.installId,signal:'response:0x2019'})
        assert.equal(filtered.sessions.length,56)
        assert.ok(filtered.events.every(e=>e.code===0x2019))
    }finally{await handle(request('/v2/installation','DELETE',user.installKey));await database.close()}
})

test('session summaries stay exact through uploads, late identity, withdrawal, rebuild and refresh', {skip:!process.env.DATABASE_URL}, async()=>{
    let database=await postgresDatabase(process.env.DATABASE_URL!)
    let handle=createTelemetry(database,{publicUrl:'https://telemetry.example'})
    const user=await enroll(handle),other=await enroll(handle)
    const pool=new Pool({connectionString:process.env.DATABASE_URL!})
    const session=randomUUID(),native=randomUUID()
    const upload=async(who:typeof user,camera:Record<string,unknown>,entries:Record<string,unknown>[])=>{
        const payload=batch(),entry=payload.contributions[0].entries[0]
        Object.assign(payload.contributions[0].camera,camera)
        payload.contributions[0].entries=entries.map(fields=>({...entry,occurredAt:new Date().toISOString(),...fields})) as any
        const sent=await handle(request('/v2/batches','POST',who.installKey,payload))
        assert.equal(sent.status,202,await sent.text())
        return payload
    }
    const summaries=async()=>(await pool.query(`SELECT session_id,events::int,errors::int,signals::int,model,manufacturer,hardware_fingerprints,stale
        FROM telemetry_sessions WHERE installation_id=$1 ORDER BY session_id`,[user.installId])).rows
    const recomputed=async()=>(await pool.query(`SELECT session_id,count(*)::int AS events,
        count(*) FILTER (WHERE failed OR (kind='response' AND code IS NOT NULL AND code<>8193))::int AS errors
        FROM telemetry_events WHERE installation_id=$1 AND session_id IS NOT NULL GROUP BY 1 ORDER BY 1`,[user.installId])).rows
    try{
        // The first commands of a connection are uploaded before its identity read completes.
        const early=await upload(user,{manufacturer:'Unknown',model:'Unknown',firmware:'unknown'},[
            {sessionId:session,kind:'connect',code:undefined},{sessionId:session,kind:'command',code:0x1002},
            {sessionId:native,kind:'command',code:0x9210}])
        let rows=await summaries()
        assert.deepEqual(rows.map(row=>row.model),['Unknown','Unknown'])
        await upload(user,{manufacturer:'Canon.Inc',model:'Canon EOS R6 Mark III',firmware:'3-1.0.1'},[
            {sessionId:session,kind:'response',code:0x2019},{sessionId:session,kind:'response',code:0x2001,failed:true}])
        rows=await summaries()
        const identified=rows.find(row=>row.session_id===session),unidentified=rows.find(row=>row.session_id===native)
        assert.deepEqual([identified.events,identified.errors,identified.signals,identified.model],[4,2,2,'Canon EOS R6 Mark III'])
        assert.equal(unidentified.model,'Unknown','a session that never read identity is not given one')
        const events=await pool.query('SELECT model,firmware FROM telemetry_events WHERE installation_id=$1 AND session_id=$2',[user.installId,session])
        assert.ok(events.rows.every(row=>row.model==='Canon EOS R6 Mark III'&&row.firmware==='3-1.0.1'),'early events adopt the session identity')
        assert.match((await database.get(`diagnostics/${user.installId}_${early.id}`))!.payload,/"model":"Unknown"/,'signed source payload is unchanged')
        const report=await database.operator.report({days:1,installation:user.installId,includeEvents:false})
        assert.deepEqual([report.summary.events,report.summary.errors,report.summary.sessions],[5,2,2])
        assert.equal((await database.operator.suggestions('model','',{days:1,installation:user.installId})).items.find(item=>item.value==='Unknown').events,1)
        assert.equal((await database.operator.report({days:1,installation:user.installId,signal:'response:0x2019',includeEvents:false})).sessions.length,1)
        assert.equal((await database.operator.report({days:1,installation:user.installId,model:'Canon EOS R6 Mark III',includeEvents:false})).summary.events,4)

        // Rebuilding from raw events yields exactly what incremental maintenance produced.
        const before=await summaries()
        await pool.query("DELETE FROM telemetry_rollup_state; UPDATE telemetry_sessions SET events=999 WHERE installation_id='"+user.installId+"'")
        await database.close();database=await postgresDatabase(process.env.DATABASE_URL!)
        handle=createTelemetry(database,{publicUrl:'https://telemetry.example'})
        assert.deepEqual(await summaries(),before)
        assert.deepEqual((await summaries()).map(({session_id,events,errors})=>({session_id,events,errors})),await recomputed())

        // Removing one batch decrements immediately; maintenance then refreshes bounds and labels.
        await pool.query('DELETE FROM telemetry_state WHERE path=$1',[`diagnostics/${user.installId}_${early.id}`])
        rows=await summaries()
        assert.deepEqual(rows.map(row=>[row.session_id,row.events,row.stale]),[[session,2,true]])
        assert.deepEqual((await pool.query('SELECT signal,events::int FROM telemetry_session_signals WHERE installation_id=$1 ORDER BY signal',[user.installId])).rows,
            [{signal:'failed',events:1},{signal:'response:0x2019',events:1}])
        await database.refreshSessions()
        assert.deepEqual((await summaries()).map(row=>[row.events,row.errors,row.stale]),[[2,2,false]])

        // Another installation's withdrawal never touches these summaries; this one's removes them.
        await upload(other,{},[{sessionId:randomUUID()}])
        await handle(request('/v2/installation','DELETE',other.installKey))
        assert.equal((await summaries()).length,1)
        await handle(request('/v2/installation','DELETE',user.installKey))
        assert.deepEqual(await summaries(),[])
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM telemetry_session_signals WHERE installation_id=$1',[user.installId])).rows[0].n,0)
    }finally{
        for(const who of [user,other])await handle(request('/v2/installation','DELETE',who.installKey)).catch(()=>{})
        await database.close();await pool.end()
    }
})

test('the unknown-code queue reads its summary: counts across installations, a current source, and removal with its events', {skip:!process.env.DATABASE_URL}, async()=>{
    let database=await postgresDatabase(process.env.DATABASE_URL!)
    let handle=createTelemetry(database,{publicUrl:'https://telemetry.example'})
    const users=[await enroll(handle),await enroll(handle)],pool=new Pool({connectionString:process.env.DATABASE_URL!})
    const model='Queue body '+randomUUID().slice(0,8)
    const upload=async(user:typeof users[0],codes:number[])=>{
        const payload=batch(),entry=payload.contributions[0].entries[0]
        Object.assign(payload.contributions[0].camera,{model})
        payload.contributions[0].entries=codes.map(code=>({...entry,sessionId:randomUUID(),kind:'data',protocol:{type:'unknown',vendorId:0x04a9,category:'operation',code,advertised:true}})) as any
        const sent=await handle(request('/v2/batches','POST',user.installKey,payload));assert.equal(sent.status,202,await sent.text())
        return 'diagnostics/'+user.installId+'_'+payload.id
    }
    try{
        const first=await upload(users[0],[0x9101,0x9101,0x9102])
        const second=await upload(users[0],[0x9101])
        await upload(users[1],[0x9101])
        let queue=await database.operator.protocol({days:1,model})
        const item=(code:number)=>queue.items.find(row=>Number(row.code)===code)
        assert.deepEqual([queue.items.length,item(0x9101).occurrences,item(0x9101).installations,item(0x9102).occurrences],[2,4,2,1])
        assert.deepEqual(await database.operator.protocolFromEvents({days:1,model}).then(old=>old.items.map(row=>[Number(row.code),row.occurrences,row.installations]).sort()),
            queue.items.map(row=>[Number(row.code),row.occurrences,row.installations]).sort(),'the summary agrees with a direct read of the events')
        const own=await database.operator.protocol({days:1,model,installation:users[0].installId})
        assert.equal(own.items.find(row=>Number(row.code)===0x9101).source,second,'the newest batch is the source')
        // Rebuilding from events gives the same queue.
        await pool.query("DELETE FROM telemetry_rollup_state WHERE name='unknown-codes-v1'; UPDATE telemetry_unknown_codes SET occurrences=999 WHERE model=$$"+model+"$$")
        await database.close();database=await postgresDatabase(process.env.DATABASE_URL!);handle=createTelemetry(database,{publicUrl:'https://telemetry.example'})
        queue=await database.operator.protocol({days:1,model})
        assert.deepEqual([item(0x9101).occurrences,item(0x9101).installations,item(0x9102).occurrences],[4,2,1])
        // Removing the newest batch moves the source to the remaining one; removing all removes the entry.
        await pool.query('DELETE FROM telemetry_state WHERE path=$1',[second])
        const remaining=await database.operator.protocol({days:1,model,installation:users[0].installId})
        assert.deepEqual(remaining.items.map(row=>[Number(row.code),row.occurrences,row.source]).sort(),[[0x9101,2,first],[0x9102,1,first]])
        await handle(request('/v2/installation','DELETE',users[0].installKey))
        queue=await database.operator.protocol({days:1,model})
        assert.deepEqual(queue.items.map(row=>[Number(row.code),row.occurrences,row.installations]),[[0x9101,1,1]])
    }finally{
        for(const user of users)await handle(request('/v2/installation','DELETE',user.installKey)).catch(()=>{})
        await database.close();await pool.end()
    }
})
