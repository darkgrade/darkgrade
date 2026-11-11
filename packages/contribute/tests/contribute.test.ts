import { createContributions, type CameraContext, type CameraTransport } from '@darkgrade/contribute'
import { fileConsentStore } from '@darkgrade/contribute/node'
import { validateContribution } from '@darkgrade/contribute/schema'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const camera: CameraContext = {
    manufacturer: 'Canon',
    model: 'EOS 80D',
    firmware: '1.0.3',
    revision: '2e5ba0f',
    dirty: false,
    transport: 'usb',
    evidence: 'synthetic',
}
function packet(type = 1, code = 0x100e) {
    const bytes = new Uint8Array(32)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, bytes.length, true)
    view.setUint16(4, type, true)
    view.setUint16(6, code, true)
    bytes.set(new TextEncoder().encode('PRIVATE-IMAGE-SERIAL'), 12)
    return bytes
}
function transport(): CameraTransport {
    return {
        connect: async () => {},
        disconnect: async () => {},
        classRequestReset: async () => {},
        send: async () => {},
        receive: async () => packet(2),
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => 'usb',
    }
}
function setup(
    enabled: boolean | null = true,
    fetcher: typeof fetch = async () => new Response(null, { status: 202 })
) {
    let saved = enabled
    return {
        endpoint: 'https://collector.example',
        camera,
        accessToken: async () => 'test-token',
        consent: {
            read: async () => saved,
            write: async (value: boolean) => {
                saved = value
            },
        },
        fetch: fetcher,
    }
}

test('explicit opt-out means no collection, token retrieval or network requests', async () => {
    const options = setup(false, async () => {
        throw Error('Must not send')
    })
    options.accessToken = async () => {
        throw Error('Must not obtain token')
    }
    const client = await createContributions(options)
    await client.observe(transport()).transport.send(packet(), 9, 123)
    assert.equal(client.status().queuedEntries, 0)
    assert.equal(await client.flush(), 'disabled')
})

test('protocol diagnostics exclude payloads, parameters, serials, transaction IDs and error text', async () => {
    const bodies: string[] = []
    const client = await createContributions(
        setup(true, async (_url, init) => {
            bodies.push(String(init?.body))
            return new Response(null, { status: 202 })
        })
    )
    const source = transport()
    source.disconnect = async () => {
        throw Error('/Users/private/serial-secret.jpg')
    }
    const observed = client.observe(source).transport
    await observed.send(packet(), 923, 8675309)
    assert.deepEqual(await observed.receive(1024, 923, 8675309), packet(2))
    await assert.rejects(observed.disconnect(), /serial-secret/)
    assert.equal(await client.flush(), 'sent')
    validateContribution(JSON.parse(bodies[0]))
    assert.equal(JSON.parse(bodies[0]).entries.length, 3)
    assert.doesNotMatch(bodies[0], /PRIVATE|serial-secret|parameters|sessionId|transactionId/)
    // Random UUIDs can contain the digits of a session ID; inspect the actual entry schema.
    for (const entry of JSON.parse(bodies[0]).entries)
        assert.ok(
            Object.keys(entry).every(key =>
                ['kind', 'code', 'direction', 'bytes', 'durationMilliseconds', 'failed'].includes(key)
            )
        )
    assert.deepEqual(
        JSON.parse(bodies[0]).entries.map((entry: { kind: string }) => entry.kind),
        ['command', 'data', 'disconnect']
    )
})

test('retry preserves the same batch identity and newly collected entries', async () => {
    const bodies: string[] = []
    const client = await createContributions(
        setup(true, async (_url, init) => {
            bodies.push(String(init?.body))
            return new Response(null, { status: bodies.length === 1 ? 503 : 202 })
        })
    )
    const observed = client.observe(transport()).transport
    await observed.send(packet(), 0, 1)
    assert.equal(await client.flush(), 'retry')
    await observed.receive(64, 0, 1)
    assert.equal(await client.flush(), 'sent')
    assert.equal(bodies[0], bodies[1])
    assert.equal(client.status().queuedEntries, 1)
    assert.equal(await client.flush(), 'sent')
    assert.notEqual(JSON.parse(bodies[1]).id, JSON.parse(bodies[2]).id)
})

test('opting out while a token is loading prevents the late upload and clears queued data', async () => {
    let release!: (token: string) => void
    let tokenRequested = false
    const options = setup(true, async () => {
        throw Error('No late upload')
    })
    options.accessToken = () => {
        tokenRequested = true
        return new Promise(resolve => {
            release = resolve
        })
    }
    const client = await createContributions(options)
    await client.observe(transport()).transport.send(packet(), 0, 0)
    const upload = client.flush()
    await Promise.resolve()
    assert.equal(tokenRequested, true)
    await client.setConsent(false)
    release('late-token')
    assert.equal(await upload, 'disabled')
    assert.equal(client.status().queuedEntries, 0)
})

test('an operation spanning an opt-out and re-enable is never collected', async () => {
    let finish!: () => void
    const source = transport()
    source.send = () =>
        new Promise(resolve => {
            finish = resolve
        })
    const client = await createContributions(setup())
    const operation = client.observe(source).transport.send(packet(), 0, 1)
    await client.setConsent(false)
    await client.setConsent(true)
    finish()
    await operation
    assert.equal(client.status().queuedEntries, 0)
})

test('withdrawal failure remains opted out and can be retried; environment opt-out overrides saved consent', async () => {
    const methods: string[] = []
    const client = await createContributions(
        setup(true, async (_url, init) => {
            methods.push(init!.method!)
            return new Response(null, { status: methods.length === 1 ? 503 : 200 })
        })
    )
    await assert.rejects(client.optOut(), /retried/)
    assert.equal(client.enabled(), false)
    await client.optOut()
    assert.deepEqual(methods, ['DELETE', 'DELETE'])
    const previous = process.env.DARKGRADE_CONTRIBUTIONS
    try {
        process.env.DARKGRADE_CONTRIBUTIONS = '0'
        await client.setConsent(true)
        assert.equal(client.enabled(), false)
        assert.equal(await client.flush(), 'disabled')
    } finally {
        if (previous === undefined) delete process.env.DARKGRADE_CONTRIBUTIONS
        else process.env.DARKGRADE_CONTRIBUTIONS = previous
    }
})

test('bounded diagnostics count overflow and reject extra sensitive envelope fields', async () => {
    let body = ''
    const client = await createContributions(
        setup(true, async (_url, init) => {
            body = String(init?.body)
            return new Response(null, { status: 202 })
        })
    )
    const observed = client.observe(transport()).transport
    for (let index = 0; index < 1003; index++) await observed.send(packet(), 0, index)
    await client.flush()
    const value = JSON.parse(body)
    assert.equal(value.entries.length, 1000)
    assert.equal(value.droppedEntries, 3)
    assert.throws(() => validateContribution({ ...value, photos: ['private'] }))
    assert.throws(() => validateContribution({ ...value, entries: [{ ...value.entries[0], parameters: [123] }] }))
})

test('a hung grant provider times out without blocking the camera or sending a late request', async context => {
    context.mock.timers.enable({ apis: ['setTimeout'] })
    const options = setup(true, async () => {
        throw Error('No upload without a token')
    })
    options.accessToken = () => new Promise(() => {})
    const client = await createContributions({ ...options, uploadTimeoutMilliseconds: 10 })
    await client.observe(transport()).transport.send(packet(), 0, 1)
    const pending = client.flush()
    context.mock.timers.tick(11)
    assert.equal(await pending, 'retry')
    client.close()
})

test('cloud withdrawal still runs when saving local opt-out fails', async () => {
    let withdrawn = false
    const options = setup(true, async (_url, init) => {
        withdrawn = init?.method === 'DELETE'
        return new Response(null, { status: 200 })
    })
    options.consent.write = async () => {
        throw Error('Read-only preferences')
    }
    const client = await createContributions(options)
    await assert.rejects(client.optOut(), /saving the local/)
    assert.equal(withdrawn, true)
    assert.equal(client.enabled(), false)
    client.close()
})

test('missing preferences are unset, saved choices survive reopening, and corruption fails closed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-consent-'))
    const file = join(directory, 'preference.json')
    try {
        const store = fileConsentStore(file)
        assert.equal(await store.read(), null)
        await store.write(true)
        assert.equal(await fileConsentStore(file).read(), true)
        await store.write(false)
        assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { enabled: false })
        assert.equal((await stat(file)).mode & 0o777, 0o600)
        await writeFile(file, 'corrupt preference')
        assert.equal(await store.read(), false)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('permanent payload rejection drops that batch; quota responses defer retries', async () => {
    let calls = 0
    const client = await createContributions(
        setup(true, async () => {
            calls++
            return new Response(null, { status: calls === 1 ? 400 : 429, headers: { 'retry-after': '3600' } })
        })
    )
    const observed = client.observe(transport()).transport
    await observed.send(packet(), 0, 1)
    assert.equal(await client.flush(), 'rejected')
    assert.equal(await client.flush(), 'empty')
    await observed.send(packet(), 0, 2)
    assert.equal(await client.flush(), 'retry')
    assert.equal(await client.flush(), 'retry')
    assert.equal(calls, 2)
    client.close()
})

test('new initialized clients collect metadata by default; saved opt-out survives reopening', async () => {
    let uploads = 0
    const options = setup(null, async () => {
        uploads++
        return new Response(null, { status: 202 })
    })
    const client = await createContributions(options)
    assert.equal(client.enabled(), true)
    await client.observe(transport()).transport.send(packet(), 1, 1)
    assert.equal(await client.flush(), 'sent')
    await client.setConsent(false)
    client.close()
    const reopened = await createContributions(options)
    assert.equal(reopened.enabled(), false)
    await reopened.observe(transport()).transport.send(packet(), 1, 1)
    assert.equal(await reopened.flush(), 'disabled')
    assert.equal(uploads, 1)
    reopened.close()
})

test('withdrawal uses the retained credential when upload enrollment is unavailable', async () => {
    const options = setup(true, async (_url, init) => {
        if (init?.method === 'DELETE')
            assert.equal(new Headers(init.headers).get('authorization'), 'Bearer retained-grant')
        return new Response(null, { status: 200 })
    })
    options.accessToken = async () => {
        throw Error('Enrollment offline')
    }
    const client = await createContributions({ ...options, withdrawalToken: async () => 'retained-grant' })
    await client.optOut()
    assert.equal(client.enabled(), false)
    client.close()
})
