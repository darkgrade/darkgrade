import { exportMatrixPage, MatrixExportChanged } from '#collector/matrix-pages'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { createTelemetry } from '#collector/telemetry'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batch, enroll, memoryDatabase, request } from './telemetry-fixture.ts'

test('review pages retain evidence, invalidate on withdrawal, and never export expired originals', async () => {
    const fixture = memoryDatabase()
    let now = new Date()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example', now: () => now })
    const user = await enroll(handle)
    for (let index = 0; index < 101; index++) {
        const payload = batch()
        assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, payload))).status, 202)
        await reviewDiagnostic(fixture.database, `${user.installId}_${payload.id}`, now)
    }
    const first = await exportMatrixPage(fixture.database, undefined, now)
    assert.equal(first.records.length, 100)
    assert.equal(first.done, false)
    assert.equal(first.hardwarePass, false)
    const last = await exportMatrixPage(fixture.database, first.next!, now)
    assert.equal(last.records.length, 1)
    assert.equal(last.id, first.id)
    assert.equal(last.done, true)
    assert.ok(!JSON.stringify(first).includes('keyHash'))
    now = new Date(+now + 91 * 86_400_000)
    assert.equal((await exportMatrixPage(fixture.database, undefined, now)).records.length, 0)
    assert.equal((await exportReviewedPatterns(fixture.database, now)).records.length, 0)
    await handle(request('/v2/installation', 'DELETE', user.installKey))
    await assert.rejects(exportMatrixPage(fixture.database, first.next!), MatrixExportChanged)
})

test('removing contributor credit invalidates an in-progress export without deleting original evidence', async () => {
    const fixture = memoryDatabase()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example' })
    const user = await enroll(handle)
    for (let index = 0; index < 100; index++) {
        const payload = batch()
        await handle(request('/v2/batches', 'POST', user.installKey, payload))
        await reviewDiagnostic(fixture.database, `${user.installId}_${payload.id}`)
    }
    await fixture.database.transaction(async transaction =>
        transaction.set(`contacts/${user.installId}`, {
            confirmedAt: new Date(),
            email: 'private@example.com',
            credit: { name: 'Contributor', publish: true },
        })
    )
    const first = await exportMatrixPage(fixture.database)
    assert.equal(first.records[0].credit.name, 'Contributor')
    assert.doesNotMatch(JSON.stringify(first), /private@example/)
    assert.equal((await handle(request('/v2/contact', 'DELETE', user.installKey))).status, 200)
    await assert.rejects(exportMatrixPage(fixture.database, first.next!), MatrixExportChanged)
    const replacement = await exportMatrixPage(fixture.database)
    assert.equal(replacement.records.length, 100)
    assert.equal(replacement.records[0].credit, null)
})
