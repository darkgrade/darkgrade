import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { cleanupWithdrawals, createTelemetry, DAILY_BATCH_LIMIT, type ContactMessage } from '#collector/telemetry'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batch, enroll, memoryDatabase, request } from './telemetry-fixture.ts'

test('daily quota retains accepted duplicates and resets at UTC midnight with a precise retry deadline', async () => {
    const { database } = memoryDatabase()
    let now = new Date('2026-11-17T23:59:58.100Z')
    const handle = createTelemetry(database, {
        publicUrl: 'https://telemetry.example',
        now: () => now,
        dailyBatchLimit: 1,
    })
    const { installKey } = await enroll(handle),
        original = batch()
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, original))).status, 202)
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, original))).status, 202)
    const limited = await handle(request('/v2/batches', 'POST', installKey, batch()))
    assert.equal(limited.status, 429)
    assert.equal(limited.headers.get('retry-after'), '2')
    assert.equal((await limited.json()).error, 'Daily batch limit reached')
    now = new Date('2026-11-18T00:00:00.000Z')
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, batch()))).status, 202)
})

test('an explicit larger service budget preserves existing quota counts and does not replace installation identity', async () => {
    const { database, records } = memoryDatabase(),
        now = new Date('2026-11-17T23:00:00Z')
    const handle = createTelemetry(database, {
        publicUrl: 'https://telemetry.example',
        now: () => now,
        dailyBatchLimit: 16384,
    })
    const { installKey, installId } = await enroll(handle)
    const key = `uploadQuotas/${installId}_2026-11-17`
    records.set(key, { count: DAILY_BATCH_LIMIT })
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, batch()))).status, 202)
    assert.equal(records.get(key).count, DAILY_BATCH_LIMIT + 1)
    records.set(key, { count: 16384 })
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, batch()))).status, 429)
    assert.equal((await handle(request('/v2/installation', 'DELETE', installKey))).status, 200)
})

test('invalid daily upload budgets fail before serving requests', () => {
    for (const limit of [0, -1, 1.5, NaN, Infinity, 65537])
        assert.throws(
            () =>
                createTelemetry(memoryDatabase().database, {
                    publicUrl: 'https://telemetry.example',
                    dailyBatchLimit: limit,
                }),
            /daily batch limit/
        )
})

test('anonymous enrollment, atomic duplicate uploads, 90-day retention and no credentials in diagnostic records', async () => {
    const { database, records } = memoryDatabase()
    const now = new Date('2026-11-11T00:00:00Z')
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example', now: () => now })
    const { installId, installKey } = await enroll(handle),
        body = batch()
    const replies = await Promise.all(
        Array.from({ length: 10 }, () => handle(request('/v2/batches', 'POST', installKey, body)))
    )
    assert.ok(replies.every(reply => reply.status === 202))
    const rows = [...records.entries()].filter(([path]) => path.startsWith('diagnostics/'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0][1].expiresAt.toISOString(), '2027-02-09T00:00:00.000Z')
    assert.equal(rows[0][1].installId, installId)
    assert.ok(!JSON.stringify(rows).includes(installKey))
    assert.ok(!JSON.stringify(rows).includes('keyHash'))
    assert.equal(records.get(`uploadQuotas/${installId}_2026-11-11`)?.count, 1)
    body.contributions[0].entries[0].bytes++
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, body))).status, 409)
})

test('withdrawal blocks writes and reviews before retrying interrupted deletion', async () => {
    const fixture = memoryDatabase()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example' })
    const { installId, installKey } = await enroll(handle),
        body = batch()
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, body))).status, 202)
    await reviewDiagnostic(fixture.database, `${installId}_${body.id}`)
    assert.equal((await exportReviewedPatterns(fixture.database)).records.length, 1)
    fixture.failDeletes(true)
    const deletion = await handle(request('/v2/installation', 'DELETE', installKey))
    assert.equal(deletion.status, 202)
    assert.equal((await deletion.json()).deletionPending, true)
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, batch()))).status, 410)
    await assert.rejects(reviewDiagnostic(fixture.database, `${installId}_${body.id}`), /withdrew/)
    assert.equal((await exportReviewedPatterns(fixture.database)).records.length, 0)
    fixture.failDeletes(false)
    assert.deepEqual(await cleanupWithdrawals(fixture.database), { cleaned: 1, failed: 0, more: false })
    assert.equal((await handle(request('/v2/installation', 'GET', installKey))).status, 200)
    assert.equal(
        [...fixture.records.keys()].filter(key => key.startsWith('diagnostics/') || key.startsWith('reviewedPatterns/'))
            .length,
        0
    )
    assert.equal(fixture.records.get(`installations/${installId}`)?.revoked, true)
    assert.equal((await handle(request('/v2/installation', 'DELETE', installKey))).status, 200)
})

test('email confirmation is separate, expires, is single-use, and only verified choices provide credit', async () => {
    const { database, records } = memoryDatabase()
    let date = new Date('2026-11-11T00:00:00Z')
    const sent: ContactMessage[] = []
    const handle = createTelemetry(database, {
        publicUrl: 'https://telemetry.example',
        now: () => date,
        sendContact: async message => {
            sent.push(message)
        },
    })
    const { installId, installKey } = await enroll(handle),
        body = batch()
    await handle(request('/v2/batches', 'POST', installKey, body))
    const recordId = `${installId}_${body.id}`
    const contact = { email: 'Contributor@example.com', credit: { name: 'Camera contributor', publish: true } }
    assert.equal((await handle(request('/v2/contact', 'POST', installKey, contact))).status, 202)
    assert.equal((await reviewDiagnostic(database, recordId, date)).credit, null)
    const token = new URL(sent[0].confirmationUrl).hash.slice(1)
    assert.ok(!sent[0].confirmationUrl.includes('?'))
    assert.equal((await handle(request('/v2/contact/confirm', 'POST', undefined, { token }))).status, 200)
    assert.equal((await handle(request('/v2/contact/confirm', 'POST', undefined, { token }))).status, 410)
    assert.equal((await reviewDiagnostic(database, recordId, date)).credit?.name, 'Camera contributor')
    assert.ok(!JSON.stringify(records.get(`diagnostics/${recordId}`)).includes('example.com'))
    await handle(request('/v2/contact', 'DELETE', installKey))
    assert.equal((await exportReviewedPatterns(database)).records[0].credit, null)
    const confirm = (index: number) =>
        handle(
            request('/v2/contact/confirm', 'POST', undefined, {
                token: new URL(sent[index].confirmationUrl).hash.slice(1),
            })
        )
    date = new Date(+date + 60_000)
    await handle(request('/v2/contact', 'POST', installKey, contact))
    date = new Date(+date + 119 * 60_000)
    assert.equal((await confirm(1)).status, 200, 'confirmation still works after 119 minutes')
    await handle(request('/v2/contact', 'POST', installKey, { email: 'second@example.com' }))
    date = new Date(+date + 120 * 60_000)
    assert.equal((await confirm(2)).status, 410, 'confirmation expires exactly at two hours')
    assert.equal((await database.get(`contacts/${installId}`))?.email, 'contributor@example.com')
    assert.equal((await database.get(`contactRequests/${installId}`))?.email, 'second@example.com')
})

test('latest email replaces the verified identity only after confirmation and older links cannot undo it', async () => {
    const {database} = memoryDatabase()
    const sent: ContactMessage[] = []
    const handle = createTelemetry(database,{publicUrl:'https://telemetry.example',sendContact:async message=>{sent.push(message)}})
    const user=await enroll(handle)
    const status=async()=> (await (await handle(request('/v2/installation','GET',user.installKey))).json()).contact
    const confirm=async(index:number)=>handle(request('/v2/contact/confirm','POST',undefined,{token:new URL(sent[index].confirmationUrl).hash.slice(1)}))
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'FIRST@example.com'}))).status,202)
    assert.deepEqual(await status(),{email:'first@example.com',verified:false,credit:null})
    assert.equal((await confirm(0)).status,200)
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'second@example.com'}))).status,202)
    assert.deepEqual(await status(),{email:'first@example.com',verified:true,credit:null,pendingEmail:'second@example.com'})
    assert.equal((await confirm(1)).status,200)
    assert.deepEqual(await status(),{email:'second@example.com',verified:true,credit:null})
    assert.equal((await confirm(0)).status,410)
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'third@example.com'}))).status,202)
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'fourth@example.com'}))).status,202)
    assert.equal((await confirm(2)).status,410,'superseded pending links cannot replace a verified identity')
    assert.equal((await confirm(3)).status,200)
    assert.equal((await status()).email,'fourth@example.com')
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'fourth@example.com'}))).status,429,'same-address resend is still rate limited')
    assert.equal((await handle(request('/v2/contact','DELETE',user.installKey))).status,200)
    assert.equal(await status(),null)
    assert.equal(await database.get(`contactRequests/${user.installId}`),undefined)
    assert.equal((await handle(request('/v2/contact','POST',user.installKey,{email:'fifth@example.com'}))).status,202)
    await handle(request('/v2/installation','DELETE',user.installKey))
    assert.equal((await confirm(sent.length-1)).status,410,'withdrawal invalidates a pending challenge')
    assert.equal(await database.get(`contacts/${user.installId}`),undefined)
})

test('quotas, malformed bodies, email injection and untrusted origins are rejected', async () => {
    const { database, records } = memoryDatabase()
    const handle = createTelemetry(database, {
        publicUrl: 'https://telemetry.example',
        allowedOrigins: ['https://studio.example'],
        dailyEnrollmentLimit: 1,
        sendContact: async () => {},
    })
    const { installId, installKey } = await enroll(handle)
    await assert.rejects(enroll(handle))
    assert.equal(
        (
            await handle(
                request('/v2/installations', 'POST', undefined, {
                    noticeVersion: 'camera-diagnostics-90d/v1',
                    installKey: 'dgi_' + '-'.repeat(36) + '.' + 'A'.repeat(43),
                })
            )
        ).status,
        400
    )
    const invalid = batch() as any
    invalid.contributions[0].camera.serial = 'private'
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, invalid))).status, 400)
    assert.equal(
        (await handle(request('/v2/contact', 'POST', installKey, { email: 'a@b.com\r\nBCC:target@b.com' }))).status,
        400
    )
    records.set(`uploadQuotas/${installId}_${new Date().toISOString().slice(0, 10)}`, { count: DAILY_BATCH_LIMIT })
    assert.equal((await handle(request('/v2/batches', 'POST', installKey, batch()))).status, 429)
    assert.equal((await handle(request('/v2/installation', 'GET', 'dgi_bad.invalid'))).status, 401)
    assert.equal(
        (
            await handle(
                request('/v2/installation', 'GET', installKey, undefined, { origin: 'https://attacker.example' })
            )
        ).status,
        403
    )
    const allowed = await handle(
        request('/v2/installation', 'OPTIONS', undefined, undefined, { origin: 'https://studio.example' })
    )
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://studio.example')
    assert.equal(allowed.headers.get('access-control-allow-credentials'), null)
})

test('expired diagnostics cannot be reviewed and reviewed metadata never becomes a hardware pass', async () => {
    const { database } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const { installId, installKey } = await enroll(handle),
        body = batch()
    await handle(request('/v2/batches', 'POST', installKey, body))
    const reviewed = await reviewDiagnostic(database, `${installId}_${body.id}`)
    assert.equal(reviewed.hardwarePass, false)
    assert.equal(reviewed.evidence, 'diagnostic-pattern')
    assert.equal(reviewed.patterns[0].camera.evidence, 'synthetic')
    await assert.rejects(
        reviewDiagnostic(database, `${installId}_${body.id}`, new Date(Date.now() + 91 * 86_400_000)),
        /expired/
    )
})
