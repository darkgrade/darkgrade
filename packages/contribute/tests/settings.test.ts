import { createApplicationDiagnostics } from '#contribute/application'
import { localDiagnostics, sharedSettings } from '#contribute/settings'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('a temporary external opt-out cannot leave old sharing entries queued for a later opt-in', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-opt-out-queue-'))
    const store = sharedSettings(directory),
        other = sharedSettings(directory)
    let calls = 0,
        localEntries = 0
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store,
        localRecord: () => {
            localEntries++
        },
        fetch: async () => {
            calls++
            throw Error('No upload expected')
        },
    })
    const camera = {
        manufacturer: 'Nikon',
        model: 'Z5II',
        firmware: '1',
        revision: 'abcdef0',
        dirty: false,
        transport: 'usb' as const,
        evidence: 'synthetic' as const,
    }
    const entry = {
        kind: 'command' as const,
        direction: 'out' as const,
        bytes: 12,
        durationMilliseconds: 1,
        failed: false,
    }
    try {
        client.record(camera, entry)
        const state = (await other.read())!
        await other.write({ ...state, enabled: false })
        client.record(camera, entry)
        await other.write({ ...(await other.read())!, enabled: true })
        assert.equal(await client.flush(), 'empty')
        assert.equal(calls, 0)
        assert.equal(localEntries, 2)
    } finally {
        client.close()
        await rm(directory, { recursive: true, force: true })
    }
})

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

test('a short-lived process delivers queued metadata on normal exit and retains it locally on forced exit', async () => {
    const { execFile } = await import('node:child_process')
    const { promisify } = await import('node:util')
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-exit-'))
    const moduleUrl = new URL('../dist/settings.js', import.meta.url).href
    try {
        for (const runtime of [process.execPath, 'bun'])
            for (const forced of [false, true]) {
                const home = join(directory, (runtime === 'bun' ? 'bun-' : 'node-') + (forced ? 'forced' : 'normal'))
                const code = `
              import {appendFileSync} from 'node:fs';
              globalThis.fetch=async(url,init)=>{const body=JSON.parse(init.body);appendFileSync(process.env.DARKGRADE_HOME+'/requests.jsonl',JSON.stringify({path:new URL(url).pathname})+'\\n');return Response.json(new URL(url).pathname==='/v2/installations'?{installKey:body.installKey,noticeVersion:body.noticeVersion}:{accepted:true}, {status:200})};
              const {nodeDiagnostics}=await import(${JSON.stringify(moduleUrl)});const client=await nodeDiagnostics();
              client.record({manufacturer:'Nikon',model:'Z5II',firmware:'1',revision:'abcdef0',dirty:false,transport:'usb',evidence:'synthetic'}, {kind:'command',direction:'out',bytes:12,failed:false,durationMilliseconds:1});
              ${forced ? 'process.exit(0)' : ''}
            `
                const result = await promisify(execFile)(
                    runtime,
                    runtime === 'bun' ? ['-e', code] : ['--no-warnings', '--input-type=module', '-e', code],
                    {
                        env: {
                            ...process.env,
                            DARKGRADE_HOME: home,
                            DARKGRADE_TELEMETRY_URL: 'https://fixture.example',
                        },
                        timeout: 7000,
                    }
                )
                assert.equal(result.stderr, '')
                const { readdir } = await import('node:fs/promises')
                const logs = await readdir(join(home, 'diagnostics'))
                assert.ok((await readFile(join(home, 'diagnostics', logs[0]), 'utf8')).includes('Z5II'))
                if (!forced) assert.ok((await readFile(join(home, 'requests.jsonl'), 'utf8')).includes('/v2/batches'))
            }
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('Node defaults to the hosted collector, but opt-out still stops uploads and keeps local diagnostics', async () => {
    const { nodeDiagnostics, closeNodeDiagnostics, DEFAULT_TELEMETRY_URL } = await import('#contribute/settings')
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-default-sharing-'))
    const previous = {
        home: process.env.DARKGRADE_HOME,
        url: process.env.DARKGRADE_TELEMETRY_URL,
        fetch: globalThis.fetch,
    }
    const calls: string[] = []
    process.env.DARKGRADE_HOME = directory
    delete process.env.DARKGRADE_TELEMETRY_URL
    globalThis.fetch = async (url, init) => {
        calls.push(String(url))
        const body = JSON.parse(String(init?.body))
        return Response.json(
            new URL(String(url)).pathname === '/v2/installations'
                ? { installKey: body.installKey, noticeVersion: body.noticeVersion }
                : { accepted: true }
        )
    }
    try {
        const client = (await nodeDiagnostics())!
        const camera = {
            manufacturer: 'Nikon',
            model: 'Z5II',
            firmware: '1',
            revision: 'abcdef0',
            dirty: false,
            transport: 'usb' as const,
            evidence: 'synthetic' as const,
        }
        const entry = {
            kind: 'command' as const,
            direction: 'out' as const,
            bytes: 12,
            failed: false,
            durationMilliseconds: 1,
        }
        client.record(camera, entry)
        await client.flush()
        assert.ok(calls.some(url => url === DEFAULT_TELEMETRY_URL + '/v2/batches'))
        const count = calls.length,
            store = sharedSettings(directory)
        await store.write({ ...(await store.read())!, enabled: false })
        client.record(camera, entry)
        assert.equal(await client.flush(), 'disabled')
        assert.equal(calls.length, count)
        await closeNodeDiagnostics()
        assert.ok((await readFile(join(directory, 'diagnostics', `${process.pid}.jsonl`), 'utf8')).includes('Z5II'))
    } finally {
        await closeNodeDiagnostics()
        globalThis.fetch = previous.fetch
        if (previous.home === undefined) delete process.env.DARKGRADE_HOME
        else process.env.DARKGRADE_HOME = previous.home
        if (previous.url === undefined) delete process.env.DARKGRADE_TELEMETRY_URL
        else process.env.DARKGRADE_TELEMETRY_URL = previous.url
        await rm(directory, { recursive: true, force: true })
    }
})

test('camera fingerprints are stable across installation/firmware changes and absent for missing or placeholder serials', async () => {
    const { cameraHardwareFingerprint } = await import('#contribute/schema')
    const first = await cameraHardwareFingerprint({ manufacturer: 'Nikon', model: ' Z5_2 ', serialNumber: 'ABC123\0' })
    assert.match(first!, /^camera-v1:[a-f0-9]{64}$/)
    assert.equal(
        first,
        await cameraHardwareFingerprint({ manufacturer: ' NIKON ', model: 'z5_2', serialNumber: 'ABC123' })
    )
    assert.notEqual(
        first,
        await cameraHardwareFingerprint({ manufacturer: 'Nikon', model: 'Z5_2', serialNumber: 'abc123' })
    )
    for (const serialNumber of [undefined, '', '000000', 'FFFFFFFF', 'Unknown', 'NONE', 'n/a', 'bad\nserial'])
        assert.equal(await cameraHardwareFingerprint({ manufacturer: 'Nikon', model: 'Z5_2', serialNumber }), undefined)
})

test('automatic Node clients never upload test-runner fixtures to the default collector', async () => {
    const { nodeDiagnostics, closeNodeDiagnostics } = await import('#contribute/settings')
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-test-runner-'))
    const oldHome = process.env.DARKGRADE_HOME,
        oldMode = process.env.NODE_ENV,
        oldFetch = globalThis.fetch
    process.env.DARKGRADE_HOME = directory
    process.env.NODE_ENV = 'test'
    let calls = 0
    globalThis.fetch = async () => {
        calls++
        throw Error('Unexpected network')
    }
    try {
        const client = (await nodeDiagnostics())!
        client.record(
            {
                manufacturer: 'Nikon',
                model: 'Z5II',
                firmware: '1',
                revision: 'abcdef0',
                dirty: false,
                transport: 'usb',
                evidence: 'synthetic',
            },
            { kind: 'command', direction: 'out', bytes: 12, failed: false, durationMilliseconds: 1 }
        )
        assert.equal(await client.flush(), 'disabled')
        assert.equal(calls, 0)
    } finally {
        await closeNodeDiagnostics()
        globalThis.fetch = oldFetch
        if (oldHome === undefined) delete process.env.DARKGRADE_HOME
        else process.env.DARKGRADE_HOME = oldHome
        if (oldMode === undefined) delete process.env.NODE_ENV
        else process.env.NODE_ENV = oldMode
        await rm(directory, { recursive: true, force: true })
    }
})
