import { firestoreDatabase } from '#collector/database'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { cleanupWithdrawals, createTelemetry } from '#collector/telemetry'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { batch, enroll, request } from './telemetry-fixture.ts'

test(
    'Firestore REST: concurrent retries, isolation, review, pagination and withdrawal',
    {
        skip: !process.env.FIRESTORE_EMULATOR_HOST,
        timeout: 120_000,
    },
    async () => {
        const database = firestoreDatabase('demo-darkgrade', { emulator: process.env.FIRESTORE_EMULATOR_HOST })
        const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
        const first = await enroll(handle),
            second = await enroll(handle)
        const body = batch()
        const replies = await Promise.all(
            Array.from({ length: 4 }, () => handle(request('/v2/batches', 'POST', first.installKey, body)))
        )
        assert.deepEqual(
            replies.map(reply => reply.status),
            [202, 202, 202, 202]
        )
        const rows = await database.list('diagnostics', 'installId', first.installId)
        assert.equal(rows.length, 1)
        assert.ok(rows[0].data.expiresAt instanceof Date)
        assert.equal((await database.list('diagnostics', 'installId', second.installId)).length, 0)
        await reviewDiagnostic(database, `${first.installId}_${body.id}`)
        assert.ok((await exportReviewedPatterns(database)).records.some(row => row.installId === first.installId))
        // More than a query page, and a different installation that must survive deletion.
        await database.transaction(async transaction => {
            for (let index = 0; index < 103; index++)
                transaction.set(`diagnostics/${first.installId}_fixture${index}`, { installId: first.installId })
            transaction.set(`diagnostics/${second.installId}_fixture`, { installId: second.installId })
        })
        const page = await database.list('diagnostics', 'installId', first.installId)
        assert.equal(page.length, 100)
        assert.equal((await database.list('diagnostics', 'installId', first.installId, page.at(-1)!.path)).length, 4)
        const concurrent = await Promise.all([
            handle(request('/v2/installation', 'DELETE', first.installKey)),
            handle(request('/v2/batches', 'POST', first.installKey, batch())),
        ])
        assert.ok(concurrent.every(reply => [200, 202, 410, 503].includes(reply.status)))
        await cleanupWithdrawals(database)
        assert.equal((await handle(request('/v2/batches', 'POST', first.installKey, batch()))).status, 410)
        assert.equal((await database.list('diagnostics', 'installId', first.installId)).length, 0)
        assert.equal((await database.list('diagnostics', 'installId', second.installId)).length, 1)
        assert.ok(!(await exportReviewedPatterns(database)).records.some(row => row.installId === first.installId))
        await handle(request('/v2/installation', 'DELETE', second.installKey))
    }
)
