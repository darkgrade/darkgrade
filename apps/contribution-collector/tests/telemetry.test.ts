import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { cleanupWithdrawals, createTelemetry, DAILY_BATCH_LIMIT, type ContactMessage } from '#collector/telemetry'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batch, enroll, memoryDatabase, request } from './telemetry-fixture.ts'

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

test('upload and withdrawal races cannot create late diagnostic records', async () => {
    const { database } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const { installId, installKey } = await enroll(handle)
    const replies = await Promise.all([
        ...Array.from({ length: 20 }, () => handle(request('/v2/batches', 'POST', installKey, batch()))),
        handle(request('/v2/installation', 'DELETE', installKey)),
        ...Array.from({ length: 20 }, () => handle(request('/v2/batches', 'POST', installKey, batch()))),
    ])
    assert.ok(replies.every(response => [200, 202, 410].includes(response.status)))
    await cleanupWithdrawals(database)
    assert.equal((await database.list('diagnostics', 'installId', installId)).length, 0)
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
    date = new Date(+date + 60_000)
    await handle(request('/v2/contact', 'POST', installKey, contact))
    date = new Date(+date + 16 * 60_000)
    assert.equal(
        (
            await handle(
                request('/v2/contact/confirm', 'POST', undefined, {
                    token: new URL(sent[1].confirmationUrl).hash.slice(1),
                })
            )
        ).status,
        410
    )
})

test('withdrawal and replaced contact challenges cannot resurrect contact details', async () => {
    const { database } = memoryDatabase()
    let time = Date.now()
    const sent: ContactMessage[] = []
    const handle = createTelemetry(database, {
        publicUrl: 'https://telemetry.example',
        now: () => new Date(time),
        sendContact: async message => {
            sent.push(message)
        },
    })
    const { installId, installKey } = await enroll(handle)
    await handle(request('/v2/contact', 'POST', installKey, { email: 'a@example.com' }))
    time += 61_000
    await handle(request('/v2/contact', 'POST', installKey, { email: 'b@example.com' }))
    const confirm = (index: number) =>
        handle(
            request('/v2/contact/confirm', 'POST', undefined, {
                token: new URL(sent[index].confirmationUrl).hash.slice(1),
            })
        )
    assert.equal((await confirm(0)).status, 410)
    await handle(request('/v2/installation', 'DELETE', installKey))
    assert.equal((await confirm(1)).status, 410)
    assert.equal(await database.get(`contacts/${installId}`), undefined)
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
