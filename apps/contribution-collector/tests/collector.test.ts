import { createCollector, type ContributionStore } from '#collector/collector'
import { googleCloudStore } from '#collector/gcs'
import { issueGrant, verifyGrant } from '#collector/token'
import assert from 'node:assert/strict'
import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto'
import { test } from 'node:test'

const pair = generateKeyPairSync('ed25519')
const signingKey = { id: 'test-1', privateKey: pair.privateKey }
const key = { 'test-1': { publicKey: pair.publicKey, uploads: true } }
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
        signingKey
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
        signingKey,
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

test('GCS adapter uses workload identity, immutable writes and scoped deletion; auth errors fail closed', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const store = googleCloudStore('camera-test-bucket', 'camera-project', async (url, init) => {
        requests.push({ url: String(url), init })
        if (String(url).includes('metadata.google.internal'))
            return Response.json({ access_token: 'workload-token', expires_in: 3600 })
        if (init?.method === 'POST') return new Response(null, { status: 412 })
        return new Response(null, { status: 403 })
    })
    assert.equal(await store.create('contributions/test/id.json', '{}'), false)
    assert.match(requests[1].url, /ifGenerationMatch=0/)
    assert.equal(new Headers(requests[1].init?.headers).get('authorization'), 'Bearer workload-token')
    await assert.rejects(store.revoked(randomUUID()), /Firestore read failed/)
})

test('short-lived keyed grants survive rotation for withdrawal but cannot upload with retired keys', () => {
    const fixture = setup()
    const retired = { 'test-1': { ...key['test-1'], uploads: false } }
    assert.throws(() => verifyGrant(fixture.token, retired), /Retired/)
    assert.equal(verifyGrant(fixture.token, retired, true).contributorId, fixture.contributorId)
    assert.throws(() => verifyGrant(fixture.token, {}), /key ID/)
    assert.throws(
        () =>
            issueGrant(
                {
                    contributorId: fixture.contributorId,
                    termsVersion: 'v1',
                    expiresAt: Math.floor(Date.now() / 1000) + 901,
                },
                signingKey
            ),
        /Invalid contributor grant/
    )
    const old = issueGrant(
        { contributorId: fixture.contributorId, termsVersion: 'v1', expiresAt: Math.floor(Date.now() / 1000) - 1 },
        signingKey,
        Date.now() - 60000
    )
    assert.throws(() => verifyGrant(old, key), /Expired/)
    assert.equal(verifyGrant(old, retired, true).contributorId, fixture.contributorId)
})

test('legacy migration authorizes withdrawal only and never accepts the old 90-day grant for uploads', async () => {
    const fixture = setup(),
        legacyKey = 'legacy-secret-kept-only-during-migration-12345'
    const payload = Buffer.from(
        JSON.stringify({ contributorId: fixture.contributorId, expiresAt: 1, termsVersion: 'v1' })
    ).toString('base64url')
    const token =
        payload +
        '.' +
        createHmac('sha256', legacyKey)
            .update('darkgrade-contribution-v1.' + payload)
            .digest('base64url')
    const handle = createCollector(fixture.store, key, [legacyKey])
    assert.equal((await handle(fixture.request('POST', fixture.body, token))).status, 401)
    assert.equal((await handle(fixture.request('DELETE', undefined, token))).status, 200)
    assert.equal((await handle(fixture.request('POST'))).status, 410)
})
