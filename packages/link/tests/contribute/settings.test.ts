import { createApplicationDiagnostics } from '@darkgrade/link/contribute/application'
import { localDiagnostics, sharedSettings } from '@darkgrade/link/contribute/settings'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('daily upload rejection is explicit and retains the bounded pending batch without repeating delivery early', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-daily-budget-'))
    let batches = 0
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: sharedSettings(directory),
        fetch: async (url, init) => {
            if (String(url).endsWith('/v2/installations')) {
                const body = JSON.parse(String(init!.body))
                return Response.json({ installKey: body.installKey, noticeVersion: body.noticeVersion })
            }
            batches++
            return Response.json(
                { error: 'Daily batch limit reached' },
                { status: 429, headers: { 'retry-after': '60' } }
            )
        },
    })
    try {
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
        assert.equal(await client.flush(), 'retry')
        assert.equal(client.status().error, 'Daily diagnostics upload limit reached')
        assert.equal(client.status().queuedEntries, 1)
        assert.equal(client.status().droppedEntries, 0)
        assert.equal(await client.flush(), 'retry')
        assert.equal(batches, 1)
    } finally {
        client.close()
        await rm(directory, { recursive: true, force: true })
    }
})

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
    const moduleUrl = import.meta.resolve('@darkgrade/link/contribute/settings')
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
    const { nodeDiagnostics, closeNodeDiagnostics, DEFAULT_TELEMETRY_URL } = await import('@darkgrade/link/contribute/settings')
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
    const { cameraHardwareFingerprint } = await import('@darkgrade/link/contribute/schema')
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
    const { nodeDiagnostics, closeNodeDiagnostics } = await import('@darkgrade/link/contribute/settings')
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

test('queued entries from before the identity read are uploaded under the identity the same session read', async () => {
    const batches: any[] = []
    const client = await createApplicationDiagnostics({
        endpoint: 'https://telemetry.example',
        store: { read: async () => null, write: async () => {} },
        fetch: async (_url, init) => {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            if (body.contributions) batches.push(body)
            return Response.json(
                body.installKey ? { installKey: body.installKey, noticeVersion: body.noticeVersion } : {},
                { status: body.contributions ? 202 : 200 }
            )
        },
    })
    const context = (model: string) => ({
        manufacturer: model === 'Unknown' ? 'Unknown' : 'Sony Corporation',
        model,
        firmware: model === 'Unknown' ? 'unknown' : '2.00',
        revision: 'abcdef0',
        dirty: false,
        transport: 'usb' as const,
        evidence: 'synthetic' as const,
    })
    const source = {
        connect: async () => {},
        disconnect: async () => {},
        classRequestReset: async () => {},
        send: async () => {},
        receive: async () => new Uint8Array(12),
        isConnected: () => true,
        isLittleEndian: () => true,
        getType: () => 'usb',
    }
    try {
        const observed = client.observe(source, context('Unknown'))
        // An earlier connection that never read identity stays unidentified.
        await observed.transport.connect()
        await observed.transport.send(new Uint8Array(12), 1, 1)
        await observed.transport.connect()
        await observed.transport.send(new Uint8Array(12), 1, 1)
        observed.identify(context('ILCE-6700'))
        await observed.transport.send(new Uint8Array(12), 1, 2)
        await client.flush()
        const cameras = batches.flatMap(batch => batch.contributions)
        const sessions = (model: string) => [
            ...new Set(
                cameras
                    .filter((item: any) => item.camera.model === model)
                    .flatMap((item: any) => item.entries.map((entry: any) => entry.sessionId))
            ),
        ]
        assert.equal(sessions('Unknown').length, 1)
        assert.equal(sessions('ILCE-6700').length, 1)
        assert.notEqual(sessions('Unknown')[0], sessions('ILCE-6700')[0])
        const identified = cameras.find((item: any) => item.camera.model === 'ILCE-6700').entries
        assert.deepEqual(
            identified.map((entry: any) => entry.kind),
            ['connect', 'unknown', 'unknown'],
            'chronological order is kept'
        )
    } finally {
        client.close()
    }
})

test('already-shared protocol facts are remembered across processes, re-shared on change or age, and survive a damaged file', async () => {
    const { reportedFacts } = await import('@darkgrade/link/contribute/settings')
    const { writeFile } = await import('node:fs/promises')
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-facts-'))
    try {
        const scope = 'camera-v1:' + 'a'.repeat(64),
            now = Date.now()
        const worker = reportedFacts(directory)
        assert.equal(worker.fresh(scope, 'unknown:operation:37121', '{"code":37121}', now), true)
        assert.equal(worker.fresh(scope, 'unknown:operation:37121', '{"code":37121}', now + 1000), false)
        worker.save()
        const saved = await readFile(join(directory, 'reported-facts.json'), 'utf8')
        assert.doesNotMatch(saved, /camera-v1|37121|operation/, 'only short hashes are stored')
        assert.equal((await stat(join(directory, 'reported-facts.json'))).mode & 0o777, 0o600)
        // A later bench worker is a new process: it must not share the same fact again.
        const next = reportedFacts(directory)
        assert.equal(next.fresh(scope, 'unknown:operation:37121', '{"code":37121}', now + 2000), false)
        assert.equal(
            next.fresh(scope, 'unknown:operation:37121', '{"code":37121,"advertised":false}', now + 3000),
            true,
            'a changed fact is shared'
        )
        assert.equal(
            next.fresh('another body', 'unknown:operation:37121', '{"code":37121}', now + 3000),
            true,
            'another body is separate'
        )
        assert.equal(
            reportedFacts(directory).fresh(scope, 'unknown:operation:37121', '{"code":37121}', now + 7 * 3_600_000),
            true,
            'shared again after six hours'
        )
        // Two processes saving in turn keep each other's entries.
        next.save()
        const first = reportedFacts(directory),
            second = reportedFacts(directory)
        first.fresh(scope, 'one', '1', now)
        second.fresh(scope, 'two', '2', now)
        first.save()
        second.save()
        const merged = reportedFacts(directory)
        assert.equal(merged.fresh(scope, 'one', '1', now + 10), false)
        assert.equal(merged.fresh(scope, 'two', '2', now + 10), false)
        await writeFile(join(directory, 'reported-facts.json'), '{broken')
        assert.equal(
            reportedFacts(directory).fresh(scope, 'one', '1', now + 20),
            true,
            'a damaged file only means sharing once more'
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('the record of cameras last seen at a USB identity keeps what the body reported and never a raw serial', async () => {
    const { knownCameras } = await import('@darkgrade/link/contribute/settings')
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-known-'))
    try {
        const store = knownCameras(directory),
            fingerprint = 'camera-v1:' + 'b'.repeat(64)
        const byModel = { vendorId: 0x04a9, productId: 0x3329 },
            bySerial = { vendorId: 0x054c, productId: 0x0e78, serialNumber: 'PRIVATE-SERIAL' }
        assert.equal(store.lookup(byModel), undefined)
        store.remember(byModel, {
            manufacturer: 'Canon.Inc',
            model: 'Canon EOS R8 Mark II',
            hardwareFingerprint: fingerprint,
        })
        store.remember(bySerial, {
            manufacturer: 'Sony Corporation',
            model: 'ILCE-6700',
            hardwareFingerprint: fingerprint,
        })
        store.remember(byModel, { manufacturer: 'Unknown', model: 'Unknown' })
        // Another process reads the same file.
        const later = knownCameras(directory)
        assert.deepEqual(later.lookup(byModel), { manufacturer: 'Canon.Inc', model: 'Canon EOS R8 Mark II' })
        assert.deepEqual(later.lookup(bySerial), {
            manufacturer: 'Sony Corporation',
            model: 'ILCE-6700',
            hardwareFingerprint: fingerprint,
        })
        assert.equal(later.lookup({ ...bySerial, serialNumber: 'OTHER' }), undefined)
        assert.equal(later.lookup({ vendorId: 0x04b0 }), undefined)
        const saved = await readFile(join(directory, 'known-cameras.json'), 'utf8')
        assert.doesNotMatch(saved, /PRIVATE-SERIAL/)
        assert.equal((await stat(join(directory, 'known-cameras.json'))).mode & 0o777, 0o600)
        await (await import('node:fs/promises')).writeFile(join(directory, 'known-cameras.json'), '{broken')
        assert.equal(knownCameras(directory).lookup(byModel), undefined)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
