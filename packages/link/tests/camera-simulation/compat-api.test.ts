import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { CAPABILITIES } from '@scripts/camera-profiles/camera-capabilities'
import { ProgressLog } from '@scripts/camera-profiles/compat-progress'
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { CompatApi } from '@scripts/compat-ui/compat-api'
import { httpBackend, localBackend, type CompatBackend } from '@scripts/compat-ui/compat-backend'
import { CompatData } from '@scripts/compat-ui/compat-data'
import { createCompatMcpServer } from '@scripts/compat-ui/compat-mcp'
import { SuiteRunner } from '@scripts/compat-ui/compat-runner'
import { startCompatServer, type RunningServer } from '@scripts/compat-ui/compat-server'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const capabilities = CAPABILITIES.map(({ id, label }) => ({ id, label }))
const index = loadProfileIndex()
const scratch = mkdtempSync(path.join(tmpdir(), 'compat-api-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function matrixRow(profile: string, overrides: Partial<SupportMatrixRow> = {}): SupportMatrixRow {
    const indexed = index.get(profile)!
    return {
        profile,
        path: indexed.path,
        manufacturer: indexed.profile.manufacturer,
        line: indexed.profile.line,
        model: indexed.profile.model,
        fidelity: indexed.profile.provenance.fidelity,
        ...(indexed.profile.catalog && { catalogLine: indexed.profile.catalog.line }),
        quirks: { total: 0, simulated: 0, unverified: 0 },
        results: Object.fromEntries(
            capabilities.map(({ id }) => [
                id,
                id === 'set-property'
                    ? { status: 'fail' as const, detail: 'camera returned 0x2019' }
                    : id === 'session'
                      ? {
                            status: 'no-data' as const,
                            detail: `Profile ${profile} has no captured response for 0x1002 [0x1]`,
                        }
                      : { status: 'pass' as const, detail: 'ok' },
            ])
        ),
        ...overrides,
    }
}

/** A results directory, a README copy with the section markers, and an API whose runs are a stand-in process. */
function fixture(name: string) {
    const results = path.join(scratch, name)
    const runs = path.join(results, 'compat-runs')
    mkdirSync(runs, { recursive: true })
    const matrix: SupportMatrix = {
        generatedAt: '2026-10-28T10:00:00.000Z',
        capabilities,
        rows: [
            matrixRow('canon-eos-r6-mark-iii'),
            matrixRow('nikon-z6-iii'),
            matrixRow('sony-alpha-aps-c-e-mount-documented', { scope: 'line', transport: 'ptp-ip' }),
        ],
        lines: [],
        totals: {},
    }
    writeFileSync(path.join(results, 'camera-support-matrix.json'), JSON.stringify(matrix))
    const readme = path.join(results, 'README.md')
    writeFileSync(readme, '# x\n\n<!-- camera-compatibility:start -->\nold\n<!-- camera-compatibility:end -->\n')
    const data = new CompatData({ resultsDirectory: results, runsDirectory: runs })
    const runner = new SuiteRunner({
        // Stands in for the suite: a process that runs until it is cancelled.
        command: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'],
        logFile: path.join(results, 'run.log'),
    })
    const api = new CompatApi({ data, runner, gapsFile: path.join(results, 'GAPS.md'), readmeFile: readme })
    return { results, runs, readme, api }
}

/** A historical producer-format fixture, not a simulated runtime relabelled as physical validation. */
async function hardwareRunLog(name: string): Promise<string> {
    const row = matrixRow('olympus-e-pl5', {
        fidelity: 'hardware',
        source: { generatedAt: '2020-01-01T00:00:00Z', revision: 'historical-fixture' },
        results: Object.fromEntries(
            capabilities.map(({ id }) => [
                id,
                { status: 'no-data', detail: 'Historical import format fixture; no physical validation' },
            ])
        ),
    })
    const key = `hardware/usb/${row.profile}`
    const log = ProgressLog.start({
        source: 'hardware',
        capabilities,
        rows: [{ ...row, key, transport: 'usb' }],
        directory: path.join(scratch, `${name}-remote-runs`),
    })
    for (const { id } of capabilities) log.capabilityFinished(key, id, row.results[id], 0)
    log.rowFinished(row)
    log.finish('completed')
    return log.file!
}

async function waitFor(condition: () => boolean, timeoutMilliseconds = 5_000): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting')
        await new Promise(resolve => setTimeout(resolve, 50))
    }
}

describe('compatibility HTTP API', () => {
    let server: RunningServer
    let secured: RunningServer
    const setup = fixture('http')

    beforeAll(async () => {
        server = await startCompatServer({ port: 0, api: setup.api })
        secured = await startCompatServer({ port: 0, api: fixture('secured').api, token: 'secret' })
    }, 30_000)

    afterAll(async () => {
        await server?.close()
        await secured?.close()
    })

    const call = async (
        route: string,
        init: { method?: string; body?: string; headers?: Record<string, string> } = {},
        target = server
    ) => {
        const response = await fetch(new URL(route, target.url), init)
        const text = await response.text()
        let json: any
        try {
            json = JSON.parse(text)
        } catch {
            json = undefined
        }
        return { status: response.status, text, json }
    }
    const post = (route: string, body: unknown, headers: Record<string, string> = {}, target = server) =>
        call(
            route,
            { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } },
            target
        )

    it('lists, filters and pages cameras with the UI query string', async () => {
        const all = await call('/api/v1/cameras')
        expect(all.status).toBe(200)
        expect(all.json.total).toBe(3)
        const failing = await call('/api/v1/cameras?set-property=fail&manufacturer=canon&limit=1')
        expect(failing.json).toMatchObject({ total: 1, limit: 1, filter: 'manufacturer=canon&set-property=fail' })
        expect(failing.json.rows[0].profile).toBe('canon-eos-r6-mark-iii')
        expect((await call('/api/v1/cameras?transport=ptp-ip')).json.rows.map((row: any) => row.key)).toEqual([
            'documented/ptp-ip/sony-alpha-aps-c-e-mount-documented',
        ])
        expect((await call('/api/v1/cameras?limit=-5&offset=abc')).json).toMatchObject({ limit: 100, offset: 0 })
    })

    it('describes one camera, run status, runs, catalog, profiles and itself', async () => {
        const camera = await call('/api/v1/cameras/canon-eos-r6-mark-iii')
        expect(camera.json.camera).toMatchObject({
            model: 'EOS R6 Mark III',
            manufacturerSlug: 'canon',
            fidelity: 'captured',
        })
        expect(camera.json.camera.results[0].cells['set-property']).toMatchObject({
            status: 'fail',
            detail: 'camera returned 0x2019',
        })
        expect(camera.json.camera.quirks.length).toBeGreaterThan(0)
        expect((await call('/api/v1/cameras/no-such-camera')).status).toBe(404)
        expect((await call('/api/v1/status')).json.runner).toEqual({ running: false })
        expect(Array.isArray((await call('/api/v1/runs')).json)).toBe(true)
        const catalog = (await call('/api/v1/catalog')).json
        expect(catalog.manufacturers.find((entry: any) => entry.slug === 'canon').lines.length).toBeGreaterThan(3)
        expect(catalog.statuses).toContain('unknown')
        expect((await call('/api/v1/profiles?q=r6 mark iii')).json.profiles.map((entry: any) => entry.id)).toContain(
            'canon-eos-r6-mark-iii'
        )
        expect((await call('/api/v1')).json.endpoints).toContain('GET /api/v1/gaps')
        expect(Object.keys((await call('/api/v1/openapi.json')).json.paths)).toContain('/cameras/{profile}')
        expect((await call('/api/v1/nothing')).status).toBe(404)
        expect((await call('/api/v1/cameras', { method: 'PUT' })).status).toBe(405)
    })

    it('lists gaps per line with next actions, filtered by manufacturer, kind and area', async () => {
        const gaps = (await call('/api/v1/gaps?manufacturer=canon')).json
        const eosR = gaps.manufacturers[0].lines.find((line: any) => line.lineSlug === 'eos-r')
        expect(eosR.evidence.captured).toEqual(['canon-eos-r6-mark-iii'])
        expect(eosR.actions).toContainEqual(
            expect.objectContaining({ kind: 'capture-responses', area: 'data', items: ['0x1002 [0x1]'] })
        )
        const library = (await call('/api/v1/gaps?area=library')).json
        for (const manufacturer of library.manufacturers)
            for (const line of manufacturer.lines)
                for (const action of line.actions) expect(action.area).toBe('library')
        expect((await call('/api/v1/gaps.md')).text).toContain('# Compatibility gaps')
    })

    it('starts, refuses a second, and cancels a run it started', async () => {
        const started = await post('/api/v1/runs', { filters: { manufacturer: 'canon', fidelity: ['captured'] } })
        expect(started.status).toBe(202)
        expect(started.json.filter).toBe('manufacturer=canon&fidelity=captured')
        expect((await call('/api/v1/status')).json.runner).toMatchObject({
            running: true,
            filter: 'manufacturer=canon&fidelity=captured',
        })
        expect((await post('/api/v1/runs', {})).status).toBe(409)
        expect((await call('/api/v1/runs/active', { method: 'DELETE' })).status).toBe(200)
        await waitFor(() => !setup.api.runner.status().running)
        expect(setup.api.runner.status().last).toMatchObject({ cancelled: true })
        expect((await call('/api/v1/runs/active', { method: 'DELETE' })).status).toBe(409)
        expect((await post('/api/v1/runs', { filter: 42 })).status).toBe(400)
    })

    it('ingests a hardware run log and regenerates the merged matrix, README section and gaps', async () => {
        const runFile = await hardwareRunLog('http')
        const ingested = await post('/api/v1/ingest', { results: [runFile], merge: true })
        expect(ingested.status).toBe(200)
        expect(ingested.json.written).toEqual([path.join(setup.results, 'camera-lab', 'olympus-e-pl5.json')])
        expect(ingested.json.reports.written).toContain(
            path.relative(path.resolve(__dirname, '../..'), path.join(setup.results, 'camera-compatibility.json'))
        )
        expect((await call('/api/v1/cameras?fidelity=hardware')).json.rows[0].profile).toBe('olympus-e-pl5')
        const reports = await post('/api/v1/reports', { targets: ['readme', 'gaps'] })
        expect(reports.status).toBe(200)
        expect(readFileSync(setup.readme, 'utf8')).not.toContain('\nold\n')
        expect(existsSync(path.join(setup.results, 'GAPS.md'))).toBe(true)
        expect((await post('/api/v1/reports', { targets: ['everything'] })).status).toBe(400)
        expect((await post('/api/v1/ingest', { results: ['/no/such/file.jsonl'] })).status).toBe(400)
        expect((await post('/api/v1/ingest', { captures: [{ profile: '../etc', file: runFile }] })).status).toBe(400)
        expect((await post('/api/v1/ingest', {})).status).toBe(400)
    }, 30_000)

    it('guards control endpoints: JSON only, same origin, loopback host, size limit and token', async () => {
        expect((await call('/api/v1/runs', { method: 'POST', body: '{}' })).status).toBe(415)
        expect((await post('/api/v1/runs', {}, { origin: 'https://evil.example' })).status).toBe(403)
        expect(
            (
                await call('/api/v1/runs', {
                    method: 'POST',
                    body: 'not json',
                    headers: { 'content-type': 'application/json' },
                })
            ).status
        ).toBe(400)
        expect(
            (
                await call('/api/v1/runs', {
                    method: 'POST',
                    body: '[1]',
                    headers: { 'content-type': 'application/json' },
                })
            ).status
        ).toBe(400)
        expect((await post('/api/v1/runs', { filter: 'x'.repeat(2 * 1024 * 1024) })).status).toBe(413)
        // A DNS-rebinding page reaches the loopback address under a foreign Host name.
        const rebinding = await new Promise<number>((resolve, reject) => {
            const target = new URL('/api/v1/runs/active', server.url)
            const request = httpRequest(
                {
                    hostname: target.hostname,
                    port: target.port,
                    path: target.pathname,
                    method: 'DELETE',
                    headers: { host: 'evil.example' },
                },
                response => resolve(response.statusCode ?? 0)
            )
            request.on('error', reject)
            request.end()
        })
        expect(rebinding).toBe(403)
        expect((await post('/api/v1/runs', {}, {}, secured)).status).toBe(401)
        expect((await post('/api/v1/runs', {}, { authorization: 'Bearer wrong' }, secured)).status).toBe(401)
        expect((await post('/api/v1/runs', {}, { authorization: 'Bearer secret' }, secured)).status).toBe(202)
        expect(
            (
                await call(
                    '/api/v1/runs/active',
                    { method: 'DELETE', headers: { authorization: 'Bearer secret' } },
                    secured
                )
            ).status
        ).toBe(200)
        // Reading stays open without the token.
        expect((await call('/api/v1/cameras', {}, secured)).status).toBe(200)
        expect((await call('/camera/%E0%A4%A')).status).toBe(400)
    })
})

describe('compatibility MCP server', () => {
    let server: RunningServer
    const local = fixture('mcp-local')
    const remote = fixture('mcp-http')

    beforeAll(async () => {
        server = await startCompatServer({ port: 0, api: remote.api })
    }, 30_000)

    afterAll(async () => server?.close())

    async function connect(backend: CompatBackend): Promise<Client> {
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
        await createCompatMcpServer(backend).connect(serverTransport)
        const client = new Client({ name: 'compat-test', version: '1.0.0' })
        await client.connect(clientTransport)
        return client
    }

    async function tool(client: Client, name: string, arguments_: Record<string, unknown> = {}) {
        const result = (await client.callTool({ name, arguments: arguments_ })) as {
            isError?: boolean
            content: { type: string; text: string }[]
        }
        const text = result.content[0]?.text ?? ''
        let json: any
        try {
            json = JSON.parse(text)
        } catch {
            json = undefined
        }
        return { isError: !!result.isError, text, json }
    }

    for (const mode of ['local', 'http'] as const) {
        it(`answers every tool and resource over the ${mode} backend`, async () => {
            const setup = mode === 'local' ? local : remote
            const client = await connect(mode === 'local' ? localBackend(setup.api) : httpBackend(server.url))
            try {
                const tools = (await client.listTools()).tools.map(entry => entry.name)
                expect(tools).toEqual([
                    'list_cameras',
                    'get_camera',
                    'get_run_status',
                    'list_runs',
                    'list_gaps',
                    'start_run',
                    'cancel_run',
                    'ingest',
                    'regenerate_reports',
                ])

                const failing = await tool(client, 'list_cameras', {
                    status: { 'set-property': ['fail'] },
                    manufacturer: 'nikon',
                })
                expect(failing.json).toMatchObject({ total: 1, filter: 'manufacturer=nikon&set-property=fail' })
                expect(failing.json.rows[0]).toMatchObject({
                    profile: 'nikon-z6-iii',
                    statuses: { 'set-property': 'fail', session: 'no-data' },
                })
                if (mode === 'http')
                    expect(failing.json.uiUrl).toBe(`${server.url}?manufacturer=nikon&set-property=fail`)

                expect((await tool(client, 'get_camera', { profile: 'nikon-z6-iii' })).json.model).toBe('Z6 III')
                const missing = await tool(client, 'get_camera', { profile: 'no-such-camera' })
                expect(missing.isError).toBe(true)
                expect(missing.text).toContain('no-such-camera')

                expect((await tool(client, 'get_run_status')).json.runner.running).toBe(false)
                expect(Array.isArray((await tool(client, 'list_runs', { limit: 5 })).json)).toBe(true)
                const gaps = await tool(client, 'list_gaps', { manufacturer: 'nikon', kind: 'capture-responses' })
                expect(gaps.json.manufacturers[0].lines[0].actions[0]).toMatchObject({
                    kind: 'capture-responses',
                    items: ['0x1002 [0x1]'],
                })

                const started = await tool(client, 'start_run', {
                    filters: { manufacturer: 'sony', transport: ['ptp-ip'] },
                })
                expect(started.json).toMatchObject({ started: true, filter: 'manufacturer=sony&transport=ptp-ip' })
                expect((await tool(client, 'start_run', {})).isError).toBe(true)
                expect((await tool(client, 'cancel_run')).json.cancelled).toBe(true)
                await waitFor(() => !setup.api.runner.status().running)

                const runFile = await hardwareRunLog(`mcp-${mode}`)
                const ingested = await tool(client, 'ingest', { results: [runFile] })
                expect(ingested.json.messages[0]).toContain('hardware rows')
                expect(
                    (await tool(client, 'regenerate_reports', { targets: ['merge', 'gaps'] })).json.written.map(
                        (file: string) => path.basename(file)
                    )
                ).toEqual(['camera-lab-matrix.json', 'camera-compatibility.json', 'camera-compatibility.md', 'GAPS.md'])
                expect((await tool(client, 'ingest', { results: ['/no/such/file'] })).isError).toBe(true)
                expect((await tool(client, 'list_cameras', { fidelity: ['bogus'] })).isError).toBe(true)

                const matrix = await client.readResource({ uri: 'compat://matrix' })
                expect(JSON.parse((matrix.contents[0] as { text: string }).text).total).toBe(4)
                const gapsText = await client.readResource({ uri: 'compat://gaps' })
                expect((gapsText.contents[0] as { text: string }).text).toContain('# Compatibility gaps')
                expect((await client.listResources()).resources.map(resource => resource.uri)).toEqual([
                    'compat://matrix',
                    'compat://gaps',
                    'compat://openapi',
                ])
            } finally {
                await client.close()
            }
        }, 60_000)
    }
})
