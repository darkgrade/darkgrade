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
            assert.equal((await handle(request('/v2/batches', 'POST', user.installKey, batch()))).status, 410)
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
