import { firestoreState } from '#collector/firestore'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
const project = 'camera-project',
    prefix = `projects/${project}/databases/(default)/documents/`
function fixture() {
    const documents = new Map<string, any>()
    let abortCommits = 0,
        successfulReservations = 0
    const state = firestoreState(
        project,
        async (url, init) => {
            const body = init?.body ? JSON.parse(String(init.body)) : undefined
            if (url.endsWith(':beginTransaction')) return Response.json({ transaction: 'transaction' })
            if (url.endsWith(':rollback')) return Response.json({})
            if (url.endsWith(':batchGet'))
                return Response.json(
                    body.documents.map((name: string) =>
                        documents.has(name) ? { found: documents.get(name) } : { missing: name }
                    )
                )
            if (url.endsWith(':commit')) {
                if (body.transaction && abortCommits-- > 0) return new Response(null, { status: 409 })
                for (const write of body.writes) {
                    const current = documents.get(write.update.name)
                    if (write.currentDocument?.exists === false && current) return new Response(null, { status: 409 })
                    documents.set(write.update.name, {
                        ...write.update,
                        fields: write.updateMask ? { ...current?.fields, ...write.update.fields } : write.update.fields,
                    })
                }
                if (body.transaction) successfulReservations++
                return Response.json({})
            }
            if (url.includes('/withdrawals?'))
                return Response.json({
                    documents: [...documents.values()].filter(document =>
                        document.name.startsWith(prefix + 'withdrawals/')
                    ),
                })
            const name = url.replace('https://firestore.googleapis.com/v1/', '')
            return documents.has(name) ? Response.json(documents.get(name)) : new Response(null, { status: 404 })
        },
        () => new Date('2026-11-03T12:00:00Z')
    )
    return {
        state,
        documents,
        conflict: (count: number) => {
            abortCommits = count
        },
        reservations: () => successfulReservations,
    }
}
test('Firestore retries aborted transactions and reserves each digest once within its daily bound', async () => {
    const { state, conflict, reservations, documents } = fixture(),
        id = randomUUID(),
        digest = 'a'.repeat(64)
    conflict(2)
    assert.equal(await state.admit(id, digest), true)
    assert.equal(await state.admit(id, digest), true)
    assert.equal(reservations(), 1)
    const quota = documents.get(`${prefix}quotas/${id}-2026-11-03`)
    assert.equal(quota.fields.expiresAt.timestampValue, '2026-11-05T12:00:00.000Z')
    quota.fields.digests.arrayValue.values = Array.from({ length: 128 }, (_, i) => ({
        stringValue: i.toString(16).padStart(64, '0'),
    }))
    assert.equal(await state.admit(id, digest), false)
    assert.equal(await state.admit(id, '0'.repeat(64)), true)
})
test('revocation is durable and idempotent; reservations fail after withdrawal', async () => {
    const { state, documents } = fixture(),
        id = randomUUID()
    await state.revoke(id)
    await state.revoke(id)
    assert.equal(await state.revoked(id), true)
    assert.equal(await state.admit(id, 'a'.repeat(64)), false)
    assert.equal(documents.size, 1)
    assert.equal(documents.get(`${prefix}withdrawals/${id}`).fields.expiresAt, undefined)
})
test('withdrawal sweeps retry partial failures and revisit completed tombstones for late writes', async () => {
    const { state } = fixture(),
        first = randomUUID(),
        second = randomUUID()
    await state.revoke(first)
    await state.revoke(second)
    const remaining = new Set([first, second])
    assert.deepEqual(
        await state.sweep(async id => {
            if (id === first) throw Error('GCS outage')
            remaining.delete(id)
        }),
        { cleaned: 1, failed: 1 }
    )
    assert.deepEqual([...remaining], [first])
    assert.deepEqual(
        await state.sweep(async id => {
            remaining.delete(id)
        }),
        { cleaned: 2, failed: 0 }
    )
    remaining.add(second) // upload resumed after the first cleanup worker exited
    await state.sweep(async id => {
        remaining.delete(id)
    })
    assert.equal(remaining.size, 0)
    assert.equal(await state.revoked(first), true)
})
test('Firestore errors and exhausted conflicts fail closed, never an unlimited quota', async () => {
    const { state, conflict } = fixture()
    conflict(10)
    await assert.rejects(state.admit(randomUUID(), 'a'.repeat(64)), /contended/)
    const unavailable = firestoreState(project, async () => new Response(null, { status: 503 }))
    await assert.rejects(unavailable.revoked(randomUUID()), /read failed/)
    await assert.rejects(unavailable.revoke(randomUUID()), /revocation failed/)
    await assert.rejects(unavailable.admit(randomUUID(), 'a'.repeat(64)), /unavailable/)
})

test('an aborted revocation commit cannot be mistaken for an existing tombstone', async () => {
    const state = firestoreState(
        project,
        async url => new Response(null, { status: url.endsWith(':commit') ? 409 : 404 })
    )
    await assert.rejects(state.revoke(randomUUID()), /revocation failed/)
})
