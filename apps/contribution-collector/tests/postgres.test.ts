import { investigate } from '#collector/investigate'
import { postgresDatabase } from '#collector/postgres'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { createTelemetry } from '#collector/telemetry'
import { NOTICE_VERSION } from '@darkgrade/contribute/batch'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { batch, enroll, request } from './telemetry-fixture.ts'

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
