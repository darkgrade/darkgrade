import { firestoreDatabase } from '#collector/database'
import assert from 'node:assert/strict'
import { test } from 'node:test'

test('Firestore retries canonical precondition errors and verifies read-only guards at commit', async () => {
    let commits = 0
    const database = firestoreDatabase('demo-darkgrade', {
        accessToken: async () => 'operator-fixture',
        request: async (url, init) => {
            if (String(url).endsWith(':commit')) {
                const body = JSON.parse(String(init?.body))
                assert.ok(
                    body.writes.some(
                        (write: any) =>
                            write.verify?.endsWith('/installations/fixture') && write.currentDocument.updateTime
                    )
                )
                commits++
                return commits === 1
                    ? Response.json({ error: { status: 'FAILED_PRECONDITION' } }, { status: 400 })
                    : Response.json({})
            }
            return Response.json({
                name: 'projects/demo-darkgrade/databases/(default)/documents/installations/fixture',
                fields: { revoked: { booleanValue: false } },
                updateTime: '2026-11-11T00:00:00Z',
            })
        },
    })
    await database.transaction(async transaction => {
        assert.equal((await transaction.get('installations/fixture'))?.revoked, false)
        transaction.set('diagnostics/fixture', { accepted: true })
    })
    assert.equal(commits, 2)
})

test('Firestore refreshes an expired operator credential once and never bypasses a denied write', async () => {
    const refreshes: boolean[] = []
    let calls = 0
    const database = firestoreDatabase('demo-darkgrade', {
        accessToken: async (refresh = false) => {
            refreshes.push(refresh)
            return 'operator-fixture'
        },
        request: async () => {
            calls++
            return Response.json({}, { status: calls === 1 ? 401 : 403 })
        },
    })
    await assert.rejects(database.get('installations/fixture'))
    assert.deepEqual(refreshes, [false, true])
    assert.equal(calls, 2)
})
