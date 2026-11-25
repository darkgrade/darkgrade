import { exportMatrixPage, MatrixExportChanged } from '#telemetry-server/matrix-pages'
import { exportReviewedPatterns, reviewDiagnostic } from '#telemetry-server/review'
import { createTelemetry } from '#telemetry-server/telemetry'
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

test('all validated batches export without review and an ingestion watermark excludes concurrent uploads', async () => {
    const fixture = memoryDatabase()
    const now = new Date()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example', now: () => now })
    const user = await enroll(handle),
        originals = new Set<string>()
    for (let i = 0; i < 101; i++) {
        const payload = batch()
        originals.add(`${user.installId}_${payload.id}`)
        assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, payload))).status, 202)
    }
    const first = await exportMatrixPage(fixture.database, undefined, now)
    assert.equal(first.records.length, 100)
    assert.ok(
        first.records.every(
            r => r.schema === 'darkgrade.diagnostic-pattern/v1' && r.reviewedAt === null && r.hardwarePass === false
        )
    )
    for (let i = 0; i < 10; i++)
        assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, batch()))).status, 202)
    let page = first
    const exported = [...first.records]
    while (page.next) {
        page = await exportMatrixPage(fixture.database, page.next, now)
        assert.equal(page.id, first.id)
        exported.push(...page.records)
    }
    assert.equal(exported.length, 101)
    assert.ok(exported.every(r => originals.has(r.sourceRecord)))
    await reviewDiagnostic(fixture.database, exported[0].sourceRecord, now)
    await assert.rejects(exportMatrixPage(fixture.database, first.next!, now), MatrixExportChanged)
    const refreshed = await exportMatrixPage(fixture.database, undefined, now)
    // Later uploads have random IDs and may sort before the original first source.
    const reviewed = refreshed.records.find(record => record.sourceRecord === exported[0].sourceRecord)!
    assert.equal(reviewed.schema, 'darkgrade.reviewed-pattern/v1')
    assert.ok(reviewed.reviewedAt)
})
