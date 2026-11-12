import { createApplicationDiagnostics } from '#contribute/application'
import { localDiagnostics, sharedSettings } from '#contribute/settings'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('processes share random identity and stale enrollment writes cannot reverse an opt-out', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-settings-'))
    try {
        const first = sharedSettings(directory),
            second = sharedSettings(directory)
        const initial = (await first.read())!,
            other = (await second.read())!
        assert.equal(initial.installationId, other.installationId)
        assert.equal(initial.enrollmentKey, other.enrollmentKey)
        assert.equal(initial.enabled, true)
        await second.write({ ...other, enabled: false })
        await first.write({ ...initial, collectorOrigin: 'https://telemetry.example' })
        assert.equal(first.current!()!.enabled, false)
        await first.write({ ...initial, collectorOrigin: 'https://telemetry.example', registrationPending: true })
        assert.equal(first.current!()!.enabled, false, 'a second stale write must not resurrect sharing')
        assert.equal((await stat(join(directory, 'settings.json'))).mode & 0o777, 0o600)
        assert.equal(JSON.stringify(initial).includes('serial'), false)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('opt-out in another process stops cloud uploads but retains bounded local diagnostics without a notice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-settings-'))
    const local = localDiagnostics(directory)
    let network = 0
    const store = sharedSettings(directory)
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store,
        localRecord: local.record,
        fetch: async () => {
            network++
            throw new Error('No network expected')
        },
    })
    try {
        const other = sharedSettings(directory),
            state = (await other.read())!
        await other.write({ ...state, enabled: false })
        const transport = client.observe(
            {
                connect: async () => {},
                disconnect: async () => {},
                classRequestReset: async () => {},
                send: async () => {},
                receive: async () => new Uint8Array(),
                isConnected: () => true,
                isLittleEndian: () => true,
                getType: () => 'usb',
            },
            {
                manufacturer: 'Canon',
                model: 'EOS 90D',
                firmware: '1',
                revision: 'abcdef0',
                dirty: false,
                transport: 'usb',
                evidence: 'synthetic',
            }
        )
        await transport.transport.send(new Uint8Array(12), 1, 1)
        assert.equal(await client.flush(), 'disabled')
        assert.equal(network, 0)
        local.close()
        assert.ok((await readFile(join(directory, 'diagnostics', `${process.pid}.jsonl`), 'utf8')).includes('EOS 90D'))
        assert.equal(client.status().sharingEnabled, false)
    } finally {
        client.close()
        local.close()
        await rm(directory, { recursive: true, force: true })
    }
})
