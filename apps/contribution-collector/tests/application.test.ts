import { createTelemetry } from '#collector/telemetry'
import { createApplicationDiagnostics, type InstallationState } from '@darkgrade/contribute/application'
import { NOTICE_VERSION } from '@darkgrade/contribute/batch'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { camera, memoryDatabase } from './telemetry-fixture.ts'

function transport() {
    return {
        connect: async () => {},
        disconnect: async () => {},
        classRequestReset: async () => {},
        send: async (_bytes: Uint8Array, _session: number, _transaction: number) => {},
        receive: async () => new Uint8Array(12),
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => 'usb' as const,
    }
}
function settings(initial: InstallationState | null = null) {
    let state = initial
    return {
        store: {
            read: async () => structuredClone(state),
            write: async (value: InstallationState) => {
                state = structuredClone(value)
            },
        },
        read: () => structuredClone(state),
    }
}
const bytes = new Uint8Array([12, 0, 0, 0, 1, 0, 1, 16, 0, 0, 0, 0])

test('resuming deletion and repeating delete share the existing request instead of aborting it', async () => {
    const fixture = memoryDatabase()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example' })
    const saved = settings()
    const first = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        fetch: (url, init) => handle(new Request(url, init)),
    })
    await first.observe(transport(), camera).transport.send(bytes, 1, 1)
    assert.equal(await first.flush(), 'sent')
    first.close()
    await saved.store.write({ ...saved.read()!, enabled: false, withdrawalPending: true })
    let calls = 0
    const resumed = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        fetch: async (url, init) => {
            calls++
            return handle(new Request(url, init))
        },
    })
    try {
        await Promise.all([resumed.retryWithdrawal(), resumed.withdraw()])
        assert.equal(calls, 1)
        assert.equal(resumed.status().withdrawalPending, false)
        assert.equal(saved.read()!.enabled, false)
    } finally {
        resumed.close()
    }
})

test('a saved collector URL without registration does not require network deletion', async () => {
    const saved = settings({
        enabled: false,
        noticeVersion: NOTICE_VERSION,
        withdrawalPending: false,
        collectorOrigin: 'https://telemetry.example',
        installationId: '00000000-0000-4000-8000-000000000001',
        enrollmentKey: 'dgi_00000000-0000-4000-8000-000000000001.' + 'A'.repeat(43),
    })
    let calls = 0
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        fetch: async () => {
            calls++
            throw new Error('No registration exists')
        },
    })
    try {
        await client.withdraw()
        assert.equal(calls, 0)
        assert.equal(client.status().withdrawalPending, false)
        assert.equal(saved.read()!.enabled, false)
    } finally {
        client.close()
    }
})

test('a pending enrollment cannot send its persisted secret to a different collector', async () => {
    const saved = settings({
        enabled: true,
        noticeVersion: NOTICE_VERSION,
        withdrawalPending: false,
        collectorOrigin: 'https://original.example',
        registrationPending: true,
        installationId: '00000000-0000-4000-8000-000000000001',
        enrollmentKey: 'dgi_00000000-0000-4000-8000-000000000001.' + 'A'.repeat(43),
    })
    await assert.rejects(
        createApplicationDiagnostics({
            endpoint: 'https://different.example',
            store: saved.store,
        }),
        /another collector/
    )
})

test('one application queues multiple cameras, enrolls once and uploads one metadata-only batch', async () => {
    const { database, records } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const saved = settings()
    let notices = 0,
        enrollments = 0,
        uploads = 0
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        presentNotice: async () => {
            notices++
        },
        fetch: async (url, init) => {
            if (String(url).endsWith('/installations')) enrollments++
            if (String(url).endsWith('/batches')) uploads++
            return handle(new Request(url, init))
        },
    })
    try {
        const first = client.observe(transport(), camera),
            second = client.observe(transport(), { ...camera, model: 'EOS 90D' })
        await first.transport.send(bytes, 111, 222)
        await second.transport.send(bytes, 333, 444)
        assert.deepEqual(await Promise.all([client.flush(), client.flush()]), ['sent', 'sent'])
        assert.equal(notices, 1)
        assert.equal(enrollments, 1)
        assert.equal(uploads, 1)
        const row = [...records].find(([key]) => key.startsWith('diagnostics/'))![1]
        assert.equal(JSON.parse(row.payload).contributions.length, 2)
        assert.ok(saved.read()?.installKey)
        assert.equal(client.status().queuedEntries, 0)
        assert.ok(row.payload.includes('transactionId'))
        assert.ok(!row.payload.includes('parameters'))
        first.detach()
        second.detach()
    } finally {
        client.close()
    }
})

test('saved opt-out prevents enrollment and corrupt settings fail closed', async () => {
    const saved = settings({ enabled: false, noticeVersion: NOTICE_VERSION, withdrawalPending: false })
    let requests = 0
    const options = {
        endpoint: 'https://telemetry.example',
        store: saved.store,
        presentNotice: async () => {},
        fetch: async () => {
            requests++
            throw new Error('Must not contact cloud')
        },
    }
    const client = await createApplicationDiagnostics(options)
    try {
        await client.observe(transport(), camera).transport.send(bytes, 1, 1)
        assert.equal(await client.flush(), 'disabled')
        assert.equal(requests, 0)
    } finally {
        client.close()
    }
    await assert.rejects(
        createApplicationDiagnostics({
            ...options,
            store: { ...saved.store, read: async () => ({ enabled: true }) as any },
        })
    )
})

test('opt-out during enrollment cannot send buffered diagnostics or re-enable collection', async () => {
    const { database, records } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const saved = settings()
    let release!: () => void, started!: () => void
    const gate = new Promise<void>(resolve => {
        release = resolve
    })
    const entered = new Promise<void>(resolve => {
        started = resolve
    })
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        presentNotice: async () => {},
        fetch: async (url, init) => {
            started()
            await gate
            return handle(new Request(url, { ...init, signal: undefined }))
        },
    })
    try {
        await client.observe(transport(), camera).transport.send(bytes, 1, 1)
        const flush = client.flush()
        await entered
        await client.setConsent(false)
        release()
        assert.equal(await flush, 'disabled')
        assert.equal(saved.read()?.enabled, false)
        assert.equal([...records.keys()].filter(key => key.startsWith('diagnostics/')).length, 0)
    } finally {
        release()
        client.close()
    }
})

test('withdrawal persists across restart and retries without creating a new identity', async () => {
    const fixture = memoryDatabase()
    const handle = createTelemetry(fixture.database, { publicUrl: 'https://telemetry.example' })
    const saved = settings()
    const options = {
        endpoint: 'https://telemetry.example',
        store: saved.store,
        presentNotice: async () => {},
        fetch: async (url: string | URL | Request, init?: RequestInit) => handle(new Request(url, init)),
    }
    const first = await createApplicationDiagnostics(options)
    await first.observe(transport(), camera).transport.send(bytes, 1, 1)
    await first.flush()
    fixture.failDeletes(true)
    await first.withdraw()
    assert.equal(saved.read()?.withdrawalPending, true)
    assert.equal(first.enabled(), false)
    first.close()
    fixture.failDeletes(false)
    const second = await createApplicationDiagnostics(options)
    try {
        await second.retryWithdrawal()
        assert.equal(saved.read()?.withdrawalPending, false)
        assert.equal(saved.read()?.installKey, undefined)
        assert.equal(second.enabled(), false)
        assert.equal([...fixture.records.keys()].filter(path => path.startsWith('installations/')).length, 1)
    } finally {
        second.close()
    }
})

test('overlapping preference writes finish with the latest choice on disk', async () => {
    const saved = settings()
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: saved.store,
        presentNotice: async () => {},
    })
    try {
        await Promise.all([client.setConsent(true), client.setConsent(false)])
        assert.equal(saved.read()?.enabled, false)
        assert.equal(client.enabled(), false)
    } finally {
        client.close()
    }
})

test('first-run opt-out and environment overrides prevent enrollment', async () => {
    for (const extra of [{ presentNotice: async () => false }, { disabled: () => true }]) {
        let requests = 0
        const client = await createApplicationDiagnostics({
            endpoint: 'https://telemetry.example',
            store: settings().store,
            presentNotice: async () => {},
            fetch: async () => {
                requests++
                throw new Error('Unexpected request')
            },
            ...extra,
        })
        try {
            await client.observe(transport(), camera).transport.send(bytes, 1, 1)
            assert.equal(await client.flush(), 'disabled')
            assert.equal(requests, 0)
        } finally {
            client.close()
        }
    }
})

test('credentials are origin-bound and withdrawal reaches the server even if preference writes fail', async () => {
    const { database, records } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const saved = settings()
    let failStorage = false
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: {
            ...saved.store,
            write: async value => {
                if (failStorage) throw new Error('Storage failed')
                await saved.store.write(value)
            },
        },
        presentNotice: async () => {},
        fetch: async (url, init) => handle(new Request(url, init)),
    })
    try {
        await client.observe(transport(), camera).transport.send(bytes, 1, 1)
        await client.flush()
        await assert.rejects(
            createApplicationDiagnostics({
                endpoint: 'https://other.example',
                store: saved.store,
                presentNotice: async () => {},
            }),
            /another collector/
        )
        failStorage = true
        await assert.rejects(client.withdraw())
        assert.ok([...records].find(([path]) => path.startsWith('installations/'))?.[1].revoked)
        assert.equal(client.enabled(), false)
        assert.equal(client.status().withdrawalPending, true)
        failStorage = false
        await client.retryWithdrawal()
        assert.equal(client.status().withdrawalPending, false)
        assert.equal(saved.read()?.enabled, false)
    } finally {
        client.close()
    }
})

test('transient failures retry an immutable batch, bounded queues drop overflow, and resets still reach the camera', async () => {
    const { database } = memoryDatabase()
    const handle = createTelemetry(database, { publicUrl: 'https://telemetry.example' })
    const uploads: string[] = []
    let resets = 0
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: settings().store,
        presentNotice: async () => {},
        fetch: async (url, init) => {
            if (String(url).endsWith('/batches')) {
                uploads.push(String(init?.body))
                return Response.json({ error: 'busy' }, { status: 503 })
            }
            return handle(new Request(url, init))
        },
    })
    try {
        const observed = client.observe(
            {
                ...transport(),
                resetPort: async () => {
                    resets++
                },
            },
            camera
        )
        await observed.transport.resetPort!()
        for (let index = 0; index < 1100; index++) await observed.transport.send(bytes, 1, index)
        assert.equal(client.status().queuedEntries, 1000)
        assert.equal(client.status().droppedEntries, 101)
        assert.equal(resets, 1)
        assert.equal(await client.flush(), 'retry')
        assert.equal(await client.flush(), 'retry')
        assert.equal(uploads.length, 1) // Backoff prevents a busy loop.
        await client.setConsent(false)
        assert.equal(client.status().queuedEntries, 0)
    } finally {
        client.close()
    }
})
