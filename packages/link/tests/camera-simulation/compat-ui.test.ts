import {
    CAPABILITIES,
    evaluateCapabilities,
    simulateCamera,
    simulateCameraOverPtpIp,
} from '@scripts/camera-profiles/camera-capabilities'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { parseProgress, ProgressLog, rowsFromProgress, type PlannedRow } from '@scripts/camera-profiles/compat-progress'
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import { ingestCapture, ingestResults } from '@scripts/camera-profiles/standalone-ingest'
import { runStandalone } from '@scripts/camera-profiles/standalone-run'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { CompatData } from '@scripts/compat-ui/compat-data'
import { applyFilters, parseFilters, serializeFilters } from '@scripts/compat-ui/compat-filters'
import { buildGapReport, renderGapsMarkdown } from '@scripts/compat-ui/compat-gaps'
import { startCompatServer, type RunningServer } from '@scripts/compat-ui/compat-server'
import { applyMatrix, applyRun, emptyView } from '@scripts/compat-ui/compat-view'
import { encodeDeviceInfo } from '@transport/simulated/ptp-dataset-encoding'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { container, pcapng, urb } from './usbmon-fixture'

const capabilities = CAPABILITIES.map(({ id, label }) => ({ id, label }))
const index = loadProfileIndex()
const scratch = mkdtempSync(path.join(tmpdir(), 'compat-ui-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function results(status: 'pass' | 'no-data', detail = 'fixture'): SupportMatrixRow['results'] {
    return Object.fromEntries(capabilities.map(({ id }) => [id, { status, detail }]))
}

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
        results: results('pass'),
        ...overrides,
    }
}

function matrix(rows: SupportMatrixRow[], generatedAt = '2026-10-28T10:00:00.000Z'): SupportMatrix {
    return { generatedAt, capabilities, rows, lines: [], totals: {} }
}

function planned(row: SupportMatrixRow): PlannedRow {
    return {
        key: `${row.fidelity}/${row.transport ?? 'usb'}/${row.profile}`,
        profile: row.profile,
        path: row.path,
        manufacturer: row.manufacturer,
        line: row.line,
        model: row.model,
        fidelity: row.fidelity,
        transport: row.transport ?? 'usb',
    }
}

describe('compatibility progress log', () => {
    it('streams a run as JSONL that rebuilds its rows, ignoring a half-written last line', () => {
        const directory = path.join(scratch, 'log')
        const row = matrixRow('canon-eos-r6-mark-iii')
        const log = ProgressLog.start({ source: 'simulation', capabilities, rows: [planned(row)], directory })
        const key = planned(row).key
        for (const { id } of capabilities) {
            log.capabilityStarted(key, id)
            log.capabilityFinished(key, id, row.results[id], 3)
        }
        log.rowFinished(row)
        log.finish('completed')
        appendFileSync(log.file!, '{"type":"capability","runId":')

        const events = parseProgress(readFileSync(log.file!, 'utf8'))
        expect(events[0]?.type).toBe('run-start')
        expect(events.at(-1)?.type).toBe('run-end')
        expect(events.filter(event => event.type === 'capability')).toHaveLength(capabilities.length)
        expect(rowsFromProgress(events)).toEqual([row])
    })
})

describe('compatibility view', () => {
    const earlier = matrixRow('canon-eos-r6-mark-iii', { results: results('no-data') })

    it('shows rows a live run has not reached as queued and the capability in flight as running', () => {
        const view = emptyView()
        applyMatrix(view, matrix([earlier]), { label: 'matrix', path: 'm.json', generatedAt: '' })
        const key = planned(earlier).key
        const at = '2026-10-28T11:00:00.000Z'
        const events = parseProgress(
            [
                {
                    type: 'run-start',
                    version: 1,
                    runId: 'r',
                    at,
                    pid: 1,
                    source: 'simulation',
                    capabilities,
                    rows: [planned(earlier)],
                },
                { type: 'capability-start', runId: 'r', at, key, capability: 'session' },
                {
                    type: 'capability',
                    runId: 'r',
                    at,
                    key,
                    capability: 'session',
                    status: 'pass',
                    detail: 'ok',
                    durationMilliseconds: 1,
                },
                { type: 'capability-start', runId: 'r', at, key, capability: 'device-info' },
            ]
                .map(event => JSON.stringify(event))
                .join('\n')
        )
        const live = structuredClone(view)
        const { summary } = applyRun(live, events, { alive: true })
        const row = live.rows[0]
        expect(row.state).toBe('running')
        expect(row.cells.session?.status).toBe('pass')
        expect(row.cells['device-info']?.status).toBe('running')
        expect(row.cells.capture?.status).toBe('queued')
        expect(live.activeRun?.finishedCells).toBe(1)
        expect(summary?.cells).toBe(capabilities.length)

        // The same run, once its process is gone, leaves only what it produced.
        const settled = structuredClone(view)
        applyRun(settled, events, { alive: false })
        expect(settled.rows[0].cells.session?.status).toBe('pass')
        expect(settled.rows[0].cells.capture?.status).toBe('no-data')
        expect(settled.activeRun).toBeUndefined()
    })

    it('filters and sorts from the query string and writes it back unchanged', () => {
        const view = emptyView()
        const rows = [
            matrixRow('canon-eos-r6-mark-iii', {
                results: { ...results('pass'), 'set-property': { status: 'no-data', detail: '' } },
            }),
            matrixRow('nikon-z6-iii'),
            matrixRow('sony-alpha-aps-c-e-mount-documented', { transport: 'ptp-ip', scope: 'line' }),
        ]
        applyMatrix(view, matrix(rows), { label: 'matrix', path: 'm.json', generatedAt: '' })
        const ids = capabilities.map(({ id }) => id)
        const query = 'fidelity=captured&set-property=no-data&sort=model&order=desc'
        const filters = parseFilters(query, ids)
        expect(applyFilters(view.rows, filters).map(row => row.profile)).toEqual(['canon-eos-r6-mark-iii'])
        expect(serializeFilters(filters)).toBe(query)
        expect(applyFilters(view.rows, parseFilters('transport=ptp-ip', ids)).map(row => row.profile)).toEqual([
            'sony-alpha-aps-c-e-mount-documented',
        ])
        expect(applyFilters(view.rows, parseFilters('manufacturer=nikon&q=z6', ids))).toHaveLength(1)
        expect(applyFilters(view.rows, parseFilters('sort=model', ids)).map(row => row.model)).toEqual([
            'EOS R6 Mark III',
            'Sony A6700 (PC Control)',
            'Z6 III',
        ])
    })
})

describe('PTP/IP simulation', () => {
    it('serves a profile over PTP/IP with the same results as USB and its network DeviceInfo', async () => {
        const profile = index.get('sony-alpha-aps-c-e-mount-documented')!.profile
        const overUsb = simulateCamera(profile)
        const usbResults = await evaluateCapabilities(overUsb)
        await overUsb.camera.disconnect().catch(() => undefined)
        const overNetwork = await simulateCameraOverPtpIp(profile)
        const startedAt = Date.now()
        const networkResults = await evaluateCapabilities(overNetwork)
        await overNetwork.stop()

        const statuses = (values: SupportMatrixRow['results']) =>
            Object.fromEntries(Object.entries(values).map(([id, result]) => [id, result.status]))
        expect(statuses(networkResults)).toEqual(statuses(usbResults))
        // Unanswerable requests are cancelled, not left to time out.
        expect(networkResults.session?.status).toBe('no-data')
        expect(Date.now() - startedAt).toBeLessThan(4_000)
        expect(networkResults['device-info']?.detail).toContain('Sony Corporation')
        expect(usbResults['device-info']?.detail).not.toContain('Sony Corporation')
    })
})

describe('standalone hardware run', () => {
    it('streams progress and writes a one-row hardware matrix', async () => {
        const { profile, path: profilePath } = index.get('olympus-e-pl5')!
        const result = await runStandalone({
            profile,
            profilePath,
            // A simulated camera stands in for the USB transport the CLI uses.
            transport: new SimulatedTransport(profile),
            connection: 'usb',
            usb: ['07b4:012f'],
            host: 'desk',
            timeoutMilliseconds: 2_000,
            runsDirectory: path.join(scratch, 'standalone-runs'),
            resultsDirectory: path.join(scratch, 'standalone-results'),
        })
        expect(result.row.fidelity).toBe('hardware')
        expect(result.row.host).toBe('desk')
        expect(result.row.results.session?.status).toBe('pass')
        const written = JSON.parse(readFileSync(result.matrixFile, 'utf8')) as SupportMatrix
        expect(written.rows).toEqual([result.row])
        const events = parseProgress(readFileSync(result.runFile!, 'utf8'))
        expect(events[0]).toMatchObject({ type: 'run-start', source: 'hardware' })
        expect(rowsFromProgress(events)).toEqual([result.row])
    })
})

describe('standalone ingest', () => {
    it('starts a captured profile from a per-model mock and a usbmon capture, then simulates it', async () => {
        const mock = index.get('canon-canon-eos-r6')!
        const deviceInfo = Uint8Array.from(
            encodeDeviceInfo({ ...mock.profile.deviceInfo!, manufacturer: 'Canon Inc.', model: 'Canon EOS R6' })!
        )
        const capture = path.join(scratch, 'r6.pcapng')
        writeFileSync(
            capture,
            pcapng([
                urb('S', 0x01, container(1, 0x1001, 1)),
                urb('C', 0x81, container(2, 0x1001, 1, [], deviceInfo)),
                urb('C', 0x81, container(3, 0x2001, 1)),
                urb('S', 0x01, container(1, 0x1002, 2, [1])),
                urb('C', 0x81, container(3, 0x2001, 2)),
            ])
        )
        const directory = path.join(scratch, 'profiles')
        const result = await ingestCapture('canon-canon-eos-r6', capture, { index, profileDirectory: directory })
        expect(result.file).toBe(path.join(directory, 'canon/eos-r/canon-canon-eos-r6.json'))
        expect(result.reportedModel).toBe('Canon EOS R6')
        expect(result.profile.provenance.fidelity).toBe('captured')
        expect(result.profile.quirks).toEqual([])
        expect(result.profile.provenance.sources[1]?.location).toMatch(
            /^usbmon capture r6\.pcapng \(sha256 [0-9a-f]{64}\)$/
        )

        const simulated = simulateCamera(result.profile)
        const outcome = await evaluateCapabilities(simulated)
        await simulated.camera.disconnect().catch(() => undefined)
        expect(outcome['device-info']).toMatchObject({ status: 'pass' })
        expect(outcome.session?.status).not.toBe('fail')
    })

    it('takes hardware rows from a run log into the hardware results and keeps the log', async () => {
        const { profile, path: profilePath } = index.get('olympus-e-pl5')!
        const run = await runStandalone({
            profile,
            profilePath,
            transport: new SimulatedTransport(profile),
            connection: 'usb',
            timeoutMilliseconds: 2_000,
            runsDirectory: path.join(scratch, 'remote-runs'),
            resultsDirectory: path.join(scratch, 'remote-results'),
        })
        const hardwareDirectory = path.join(scratch, 'local-hardware')
        const runsDirectory = path.join(scratch, 'local-runs')
        const { rows, written } = ingestResults(run.runFile!, { hardwareDirectory, runsDirectory })
        expect(rows).toEqual([run.row])
        expect(written).toEqual([path.join(hardwareDirectory, 'olympus-e-pl5.json')])
        expect(existsSync(path.join(runsDirectory, path.basename(run.runFile!)))).toBe(true)
    })
})

describe('gap report', () => {
    it('lists undefined vendor operations, inexpressible requests and data gaps per line', () => {
        const row = matrixRow('canon-eos-r6-mark-iii', {
            results: {
                ...results('no-data', 'Profile canon-eos-r6-mark-iii has no captured response for 0x1002 [0x1]'),
                'vendor-operations': {
                    status: 'unsupported',
                    detail: '3/5 defined; no darkgrade definition for 0x913f 0x911b',
                },
                'recorded-exchanges': {
                    status: 'pass',
                    detail: '10/26 replayed through darkgrade definitions; parameters not expressible: 0x9114 [0x5]',
                },
            },
        })
        const report = buildGapReport(loadCatalog(), [matrix([row])])
        const line = report.manufacturers
            .flatMap(manufacturer => manufacturer.lines)
            .find(entry => entry.line === 'EOS R')!
        expect(line.undefinedVendorOperations).toEqual(['0x911b', '0x913f'])
        expect(line.inexpressibleRequests).toEqual(['0x9114 [0x5]'])
        expect(line.missingResponses).toEqual(['0x1002 [0x1]'])
        expect(line.capturedProfiles).toEqual(['canon-eos-r6-mark-iii'])
        expect(report.manufacturers.find(manufacturer => manufacturer.name === 'Fujifilm')?.vendorDefinitions).toBe(
            false
        )
        expect(renderGapsMarkdown(report)).toContain('| Canon | EOS R | 0x911b 0x913f | 0x9114 [0x5] | - |')
    })
})

describe('compatibility UI server', () => {
    let server: RunningServer
    const results = path.join(scratch, 'server-results')
    const runs = path.join(results, 'compat-runs')

    beforeAll(async () => {
        mkdirSync(runs, { recursive: true })
        const rows = [
            matrixRow('canon-eos-r6-mark-iii'),
            matrixRow('sony-alpha-aps-c-e-mount-documented', { scope: 'line' }),
            matrixRow('sony-alpha-aps-c-e-mount-documented', { scope: 'line', transport: 'ptp-ip' }),
        ]
        writeFileSync(path.join(results, 'camera-support-matrix.json'), JSON.stringify(matrix(rows)))
        // A run in progress (this process is alive) that has reached the Nikon row.
        const nikon = matrixRow('nikon-z6-iii', { fidelity: 'hardware' })
        const at = new Date().toISOString()
        const key = planned(nikon).key
        writeFileSync(
            path.join(runs, 'live-run.jsonl'),
            [
                {
                    type: 'run-start',
                    version: 1,
                    runId: 'live-run',
                    at,
                    pid: process.pid,
                    source: 'hardware',
                    capabilities,
                    rows: [planned(nikon)],
                },
                { type: 'capability-start', runId: 'live-run', at, key, capability: 'session' },
            ]
                .map(event => `${JSON.stringify(event)}\n`)
                .join('')
        )
        server = await startCompatServer({
            port: 0,
            data: new CompatData({ resultsDirectory: results, runsDirectory: runs }),
        })
    }, 30_000)

    afterAll(async () => server?.close())

    const get = async (route: string) => {
        const response = await fetch(new URL(route, server.url))
        return { status: response.status, text: await response.text() }
    }

    it('serves every route with stable URLs, filters from the query string, and 404s unknown ones', async () => {
        const home = await get('/')
        expect(home.status).toBe(200)
        expect(home.text).toContain('0/1 rows')
        expect(home.text).toContain('aria-label="Hardware run"')
        expect(home.text).toMatch(
            /data-key="hardware\/usb\/nikon-z6-iii" data-profile="nikon-z6-iii" class="r-running"/
        )
        expect(home.text).toContain('<table id="matrix" class="matrix has-run">')

        const line = await get('/m/sony/alpha-aps-c-e-mount?transport=ptp-ip')
        expect(line.status).toBe(200)
        expect(line.text.match(/<tr data-key=/g)).toHaveLength(1)
        expect(line.text).toContain('data-key="documented/ptp-ip/sony-alpha-aps-c-e-mount-documented"')

        const camera = await get('/camera/canon-eos-r6-mark-iii')
        expect(camera.status).toBe(200)
        expect(camera.text).toContain('directory-selector-empty-drops-usb')
        expect(camera.text).toContain('darkgrade/test-bench@')

        expect((await get('/gaps')).status).toBe(200)
        expect((await get('/runs')).text).toContain('live-run')
        expect((await get('/m/nope')).status).toBe(404)
        expect((await get('/camera/nope')).status).toBe(404)
        expect((await get('/assets/client.js')).text.length).toBeGreaterThan(1000)

        const view = JSON.parse((await get('/api/v1/view')).text)
        expect(view.activeRun.runId).toBe('live-run')
        expect(view.rows).toHaveLength(4)
    })

    it('imports a results file and opens it as its own view', async () => {
        const response = await fetch(new URL('/api/v1/import?name=remote.json', server.url), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(matrix([matrixRow('nikon-z7')])),
        })
        const result = (await response.json()) as { open: string }
        expect(response.status).toBe(200)
        expect(existsSync(path.join(results, 'compat-imports/remote.json'))).toBe(true)
        const page = await get(result.open)
        expect(page.text.match(/<tr data-key=/g)).toHaveLength(1)
        expect(page.text).toContain('nikon-z7')
    })
})
