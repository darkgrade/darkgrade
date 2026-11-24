import { createTelemetry, resendContactSender } from '#collector/telemetry'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enroll, memoryDatabase, request } from './telemetry-fixture.ts'

const message = {
    email: 'contributor@example.com',
    confirmationUrl: 'https://telemetry.example/confirm#private-confirmation-token',
    idempotencyKey: 'confirmation-hash',
}
const accepted = 'f1ab6c3d-1679-42fa-bc14-561b69c3e6bb'

test('Resend sends one private transactional confirmation with a bounded, idempotent request', async () => {
    const calls: { url: string; options: RequestInit }[] = []
    const sender = resendContactSender(
        'server-only-test-key',
        'Darkgrade <contact@example.com>',
        async (url, options) => {
            calls.push({ url: String(url), options: options! })
            return Response.json({ id: accepted })
        }
    )
    await sender(message)
    assert.equal(calls.length, 1)
    const call = calls[0]
    assert.equal(call.url, 'https://api.resend.com/emails')
    assert.equal(call.options.method, 'POST')
    assert.equal(call.options.redirect, 'error')
    assert.ok(call.options.signal instanceof AbortSignal)
    const headers = new Headers(call.options.headers)
    assert.equal(headers.get('authorization'), 'Bearer server-only-test-key')
    assert.equal(headers.get('idempotency-key'), message.idempotencyKey)
    const body = JSON.parse(String(call.options.body))
    assert.deepEqual(body.to, [message.email])
    assert.ok(body.text.includes(message.confirmationUrl))
    assert.match(body.text,/expires in 2 hours/)
    assert.match(body.text, /does not subscribe you to product updates/)
    assert.equal(body.tags, undefined)
    assert.doesNotMatch(JSON.stringify(body), /server-only-test-key/)
})

test('provider rejection, network loss and invalid acknowledgements never claim an email was sent', async () => {
    const failures: (() => Promise<Response>)[] = [
        async () => Response.json({ message: 'secret key and private email' }, { status: 403 }),
        async () => new Response(null, { status: 429 }),
        async () => new Response(null, { status: 503 }),
        async () => Response.json({}),
        async () => Response.json({ id: '-'.repeat(36) }),
        async () => new Response('not JSON'),
        async () => {
            throw new Error('secret key and private email')
        },
    ]
    for (const failure of failures) {
        let calls = 0
        const sender = resendContactSender('server-only-test-key', 'contact@example.com', async () => {
            calls++
            return failure()
        })
        await assert.rejects(sender(message), {
            status: 503,
            message: 'Email confirmation is temporarily unavailable. Try again shortly.',
        })
        assert.equal(calls, 1, 'unknown outcomes cannot replay an email with a different token')
    }
    for (const [key, from] of [
        ['', 'contact@example.com'],
        ['key', ''],
        ['key\n', 'contact@example.com'],
    ])
        assert.throws(() => resendContactSender(key, from), /configuration required/)
})

test('a rejected email retains only an unverified submission and cannot publish attribution or provider secrets', async () => {
    const fixture = memoryDatabase()
    const handle = createTelemetry(fixture.database, {
        publicUrl: 'https://telemetry.example',
        sendContact: resendContactSender('server-only-test-key', 'contact@example.com', async () =>
            Response.json({ message: 'server-only-test-key contributor@example.com' }, { status: 403 })
        ),
    })
    const user = await enroll(handle)
    const result = await handle(request('/v2/contact', 'POST', user.installKey, { email: message.email }))
    assert.equal(result.status, 503)
    assert.doesNotMatch(await result.text(), /server-only-test-key|contributor@example.com/)
    assert.equal(await fixture.database.get(`contacts/${user.installId}`), undefined)
    assert.equal((await fixture.database.get(`contactRequests/${user.installId}`))?.email,message.email)
    assert.equal((await fixture.database.list('diagnostics')).length, 0)
    assert.doesNotMatch(JSON.stringify([...fixture.records.values()]), /server-only-test-key/)
})
