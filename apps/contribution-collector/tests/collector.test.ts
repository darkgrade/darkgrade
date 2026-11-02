import { createCollector, type ContributionStore } from '#collector/collector'
import { googleCloudStore } from '#collector/gcs'
import { issueGrant } from '#collector/token'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

const key = 'test-signing-key-with-at-least-thirty-two-bytes'
function setup() {
    const objects = new Map<string, string>()
    const revoked = new Set<string>()
    const store: ContributionStore = {
        admit: async () => true,
        revoked: async id => revoked.has(id),
        revoke: async id => {
            revoked.add(id)
        },
        create: async (name, body) => {
            if (objects.has(name)) return false
            objects.set(name, body)
            return true
        },
        remove: async name => {
            objects.delete(name)
        },
        removeContributions: async id => {
            for (const name of objects.keys()) if (name.startsWith(`contributions/${id}/`)) objects.delete(name)
        },
    }
    const contributorId = randomUUID()
    const token = issueGrant(
        { contributorId, expiresAt: Math.floor(Date.now() / 1000) + 60, termsVersion: 'notice/v1' },
        key
    )
    const body = {
        schema: 'darkgrade.diagnostics/v1',
        disclosure: 'protocol-metadata-only/v1',
        id: randomUUID(),
        camera: {
            manufacturer: 'Sony',
            model: 'ILME-FX2',
            firmware: '1.01',
            revision: '2e5ba0f',
            dirty: false,
            transport: 'usb',
            evidence: 'synthetic',
        },
        entries: [],
        droppedEntries: 0,
    }
    const request = (method = 'POST', payload: unknown = body, credential = token) =>
        new Request('https://collector.example/v1/contributions', {
            method,
            headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
            ...(method === 'POST' && { body: JSON.stringify(payload) }),
        })
    return { objects, revoked, store, contributorId, token, body, request }
}

test('authenticated diagnostics stay private/unreviewed with per-contributor provenance and idempotent retries', async () => {
    const fixture = setup()
    const handle = createCollector(fixture.store, key)
    assert.equal((await handle(fixture.request())).status, 202)
    assert.equal((await handle(fixture.request())).status, 202)
    assert.equal(fixture.objects.size, 1)
    const record = JSON.parse([...fixture.objects.values()][0])
    assert.equal(record.review, 'unreviewed')
    assert.equal(record.provenance.contributorId, fixture.contributorId)
    assert.equal(record.provenance.credit, null)
    assert.equal(record.provenance.termsVersion, 'notice/v1')
})

test('unsigned, expired and modified tokens cannot upload; withdrawal still accepts an expired signed token', async () => {
    const fixture = setup()
    const handle = createCollector(fixture.store, key)
    const expired = issueGrant(
        {
            contributorId: fixture.contributorId,
            termsVersion: 'notice/v1',
            expiresAt: Math.floor(Date.now() / 1000) - 1,
        },
        key,
        Date.now() - 60_000
    )
    for (const token of ['', fixture.token + 'x', expired])
        assert.equal((await handle(fixture.request('POST', fixture.body, token))).status, 401)
    assert.equal((await handle(fixture.request('DELETE', undefined, expired))).status, 200)
    assert.equal((await handle(fixture.request())).status, 410)
})

test('withdrawal removes only the token owner and rejects future uploads', async () => {
    const fixture = setup()
    const handle = createCollector(fixture.store, key)
    fixture.objects.set(`contributions/${randomUUID()}/other.json`, 'other')
    await handle(fixture.request())
    assert.equal((await handle(fixture.request('DELETE'))).status, 200)
    assert.equal(fixture.objects.size, 1)
    assert.equal((await handle(fixture.request())).status, 410)
    assert.equal((await handle(fixture.request('DELETE'))).status, 200)
})

test('withdrawal racing with storage removes the late upload', async () => {
    const fixture = setup()
    const create = fixture.store.create
    fixture.store.create = async (...args) => {
        fixture.revoked.add(fixture.contributorId)
        return create(...args)
    }
    const handle = createCollector(fixture.store, key)
    assert.equal((await handle(fixture.request())).status, 410)
    assert.equal(fixture.objects.size, 0)
})

test('revocation persists when deletion fails; retry finishes deletion and uploads remain blocked', async () => {
    const fixture = setup()
    const handle = createCollector(fixture.store, key)
    await handle(fixture.request())
    const remove = fixture.store.removeContributions
    fixture.store.removeContributions = async () => {
        throw Error('Storage outage')
    }
    assert.equal((await handle(fixture.request('DELETE'))).status, 503)
    assert.equal((await handle(fixture.request())).status, 410)
    fixture.store.removeContributions = remove
    assert.equal((await handle(fixture.request('DELETE'))).status, 200)
    assert.equal(fixture.objects.size, 0)
})

test('images, extra fields, oversized bodies and invalid protocol values are rejected', async () => {
    const fixture = setup()
    const handle = createCollector(fixture.store, key)
    for (const payload of [
        { ...fixture.body, image: 'private' },
        { ...fixture.body, camera: { ...fixture.body.camera, serial: '123' } },
        {
            ...fixture.body,
            entries: [
                { kind: 'event', direction: 'in', code: 999999, bytes: 0, durationMilliseconds: 0, failed: false },
            ],
        },
        { ...fixture.body, padding: 'x'.repeat(300_000) },
    ])
        assert.equal((await handle(fixture.request('POST', payload))).status, 400)
    assert.equal(fixture.objects.size, 0)
})

test('daily quota blocks new objects without changing consent or permitting unauthenticated quota access', async () => {
    const fixture = setup()
    fixture.store.admit = async () => false
    const handle = createCollector(fixture.store, key)
    assert.equal((await handle(fixture.request())).status, 429)
    assert.equal(fixture.objects.size, 0)
    assert.equal(fixture.revoked.size, 0)
    assert.equal((await handle(fixture.request('POST', fixture.body, 'bad-token'))).status, 401)
})

test('GCS quota uses generation preconditions and preserves reservations across retries', async () => {
    let saved: string[] | undefined
    const digest = 'a'.repeat(64)
    const store = googleCloudStore('camera-test-bucket', async (url, init) => {
        const address = String(url)
        if (address.includes('metadata.google.internal'))
            return Response.json({ access_token: 'token', expires_in: 3600 })
        if (init?.method === 'POST') {
            assert.match(address, /ifGenerationMatch=0/)
            saved = JSON.parse(String(init.body))
            return new Response(null, { status: 200 })
        }
        if (address.includes('alt=media')) return Response.json(saved)
        return saved ? Response.json({ generation: '123' }) : new Response(null, { status: 404 })
    })
    const contributor = randomUUID()
    assert.equal(await store.admit(contributor, digest), true)
    assert.equal(await store.admit(contributor, digest), true)
    assert.deepEqual(saved, [digest])
})

test('GCS adapter uses workload identity, immutable writes and scoped deletion; auth errors fail closed', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const store = googleCloudStore('camera-test-bucket', async (url, init) => {
        requests.push({ url: String(url), init })
        if (String(url).includes('metadata.google.internal'))
            return Response.json({ access_token: 'workload-token', expires_in: 3600 })
        if (init?.method === 'POST') return new Response(null, { status: 412 })
        return new Response(null, { status: 403 })
    })
    assert.equal(await store.create('contributions/test/id.json', '{}'), false)
    assert.match(requests[1].url, /ifGenerationMatch=0/)
    assert.equal(new Headers(requests[1].init?.headers).get('authorization'), 'Bearer workload-token')
    await assert.rejects(store.revoked(randomUUID()), /Consent check failed/)
})
