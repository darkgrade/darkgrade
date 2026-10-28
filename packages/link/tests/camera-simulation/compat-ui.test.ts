import {
    CAPABILITIES,
    evaluateCapabilities,
    simulateCamera,
    simulateCameraOverPtpIp,
} from '@scripts/camera-profiles/camera-capabilities'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { parseProgress, ProgressLog, rowsFromProgress, type PlannedRow } from '@scripts/camera-profiles/compat-progress'
import { matrixValue, type ValidatedMatrixRow } from '@scripts/camera-profiles/compat-schema'
import { mergeCompatibility } from '@scripts/camera-profiles/compatibility-matrix'
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import { ingestCapture, ingestResults } from '@scripts/camera-profiles/standalone-ingest'
import { runStandalone } from '@scripts/camera-profiles/standalone-run'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { CompatApi } from '@scripts/compat-ui/compat-api'
import { CompatData, rowsFromCompatibility } from '@scripts/compat-ui/compat-data'
import { applyFilters, parseFilters, serializeFilters } from '@scripts/compat-ui/compat-filters'
import { buildGapReport, renderGapsMarkdown } from '@scripts/compat-ui/compat-gaps'
import { renderDetailCellContents, renderRow } from '@scripts/compat-ui/compat-pages'
import { startCompatServer, type RunningServer } from '@scripts/compat-ui/compat-server'
import { cameraPage } from '@scripts/compat-ui/compat-site'
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

function results(
    status: SupportMatrixRow['results'][string]['status'],
    detail = 'fixture'
): SupportMatrixRow['results'] {
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

describe('standalone software fixture run', () => {
    it('streams software evidence without declaring physical validation', async () => {
        const { profile: captured, path: profilePath } = index.get('olympus-e-pl5')!
        const profile = {
            ...captured,
            exchanges: [
                ...captured.exchanges,
                {
                    operation: '0x1003',
                    parameters: [],
                    response: { code: '0x2001' },
                    source: 0,
                    note: 'synthetic cleanup response for this software publication fixture',
                },
            ],
        }
        const result = await runStandalone({
            profile,
            profilePath,
            // This is software evidence; the physical CLI uses the guarded bench adapter.
            transport: new SimulatedTransport(profile),
            connection: 'usb',
            usb: ['07b4:012f'],
            host: 'desk',
            timeoutMilliseconds: 2_000,
            runsDirectory: path.join(scratch, 'standalone-runs'),
            resultsDirectory: path.join(scratch, 'standalone-results'),
        })
        expect(result.row.fidelity).toBe('captured')
        expect(result.row.host).toBe('desk')
        expect(result.row.results.session?.status).toBe('pass')
        const written = JSON.parse(readFileSync(result.matrixFile, 'utf8')) as SupportMatrix
        expect(written.rows).toEqual([result.row])
        const events = parseProgress(readFileSync(result.runFile!, 'utf8'))
        expect(events[0]).toMatchObject({ type: 'run-start', source: 'simulation' })
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

    it('takes synthetic hardware result fixtures from a run log and keeps the log', () => {
        const row = matrixRow('olympus-e-pl5', {
            fidelity: 'hardware',
            results: results('pass', 'synthetic import fixture; no camera accessed'),
        })
        const log = ProgressLog.start({
            source: 'hardware',
            capabilities,
            rows: [planned(row)],
            directory: path.join(scratch, 'remote-runs'),
        })
        for (const capability of capabilities)
            log.capabilityFinished(planned(row).key, capability.id, row.results[capability.id], 0)
        log.rowFinished(row)
        log.finish('completed')
        const hardwareDirectory = path.join(scratch, 'local-hardware')
        const runsDirectory = path.join(scratch, 'local-runs')
        const { rows, written } = ingestResults(log.file!, { hardwareDirectory, runsDirectory })
        expect(rows).toMatchObject([row])
        expect(rows[0].source?.generatedAt).toEqual(expect.any(String))
        expect(written).toEqual([path.join(hardwareDirectory, 'olympus-e-pl5.json')])
        expect(existsSync(path.join(runsDirectory, path.basename(log.file!)))).toBe(true)
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
            true
        )
        expect(
            report.manufacturers.find(manufacturer => manufacturer.name === 'OM System / Olympus')?.vendorDefinitions
        ).toBe(true)
        expect(report.workflowLimitations.join(' ')).toContain('PR #18')
        expect(renderGapsMarkdown(report)).toContain('Test Bench workflow qualification')
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

describe('compatibility UI capability provenance', () => {
    function mixedEvidence() {
        const captured = matrixRow('sony-ilce-6700', {
            usb: ['054c:0e78'],
            firmware: '2.00',
            results: results('pass', 'captured protocol replay'),
        })
        const older = { ...captured, firmware: '1.00' }
        const network = {
            ...older,
            transport: 'ptp-ip' as const,
            fidelity: 'documented' as const,
            results: results('pass', 'documented PTP/IP fixture'),
        }
        const simulation = { ...matrix([captured, older, network]), revision: 'simulation-revision' }
        const hardware = {
            ...matrix(
                [
                    {
                        ...captured,
                        fidelity: 'hardware' as const,
                        host: 'darkgrade01',
                        results: {
                            ...results('no-data'),
                            session: { status: 'pass' as const, detail: 'physical session' },
                        },
                    },
                ],
                '2026-10-28T11:00:00.000Z'
            ),
            revision: 'hardware-revision',
        }
        return mergeCompatibility(simulation, hardware)
    }

    it('keeps the selected capability source in table badges and detail cells', () => {
        const converted = rowsFromCompatibility(mixedEvidence())
        const view = emptyView()
        applyMatrix(view, converted, { label: 'merged', path: 'merged.json', generatedAt: converted.generatedAt })
        const hardware = view.rows.find(row => row.fidelity === 'hardware')!
        expect(hardware.cells.session.evidence).toMatchObject({
            fidelity: 'hardware',
            host: 'darkgrade01',
            revision: 'hardware-revision',
        })
        expect(hardware.cells.capture.evidence).toMatchObject({
            fidelity: 'captured',
            firmware: '2.00',
            revision: 'simulation-revision',
        })
        expect(hardware.cells.capture.evidence).not.toHaveProperty('host')
        const html = renderRow(hardware, capabilities, { base: '/', live: false })
        const captureCell = html.match(/<td[^>]*data-capability="capture"[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? ''
        expect(captureCell).toContain('i-pass')
        expect(captureCell).toContain('f-captured')
        const detail = renderDetailCellContents(hardware.cells.capture)
        expect(detail).toContain('f-captured')
        expect(detail).toContain('firmware 2.00')
        expect(detail).toContain('simulation-revision')
        expect(detail).not.toContain('darkgrade01')
    })

    it('keeps firmware variants and PTP/IP evidence independent in the UI adapter', () => {
        const converted = rowsFromCompatibility(mixedEvidence())
        const view = emptyView()
        applyMatrix(view, converted, { label: 'merged', path: 'merged.json', generatedAt: converted.generatedAt })
        expect(view.rows.filter(row => row.transport === 'usb')).toHaveLength(2)
        const network = view.rows.filter(row => row.transport === 'ptp-ip')
        expect(network).toHaveLength(1)
        expect(network[0].firmware).toBe('1.00')
        expect(network[0].host).toBeUndefined()
        expect(network[0].cells.session.evidence).toMatchObject({ fidelity: 'documented', firmware: '1.00' })
        expect(network[0].cells.session.evidence).not.toHaveProperty('host')
        const merged = mixedEvidence()
        const camera = merged.cameras[0]
        const sharedUsb = {
            ...merged,
            cameras: ['Sony SLT-A57', 'Sony SLT-A37'].map(model => ({
                ...camera,
                model,
                usb: ['054c:0669'],
                ptpIp: undefined,
            })),
        }
        const separate = emptyView()
        applyMatrix(separate, rowsFromCompatibility(sharedUsb), {
            label: 'shared USB',
            path: 'shared.json',
            generatedAt: merged.generatedAt,
        })
        expect(separate.rows).toHaveLength(2)
        expect(new Set(separate.rows.map(row => row.key)).size).toBe(2)
    })

    it('replaces old fallback provenance when a fresh hardware capability finishes', () => {
        const hardware = matrixRow('sony-ilce-6700', { fidelity: 'hardware' })
        const mixed = {
            ...hardware,
            resultEvidence: {
                session: {
                    fidelity: 'captured' as const,
                    profile: hardware.profile,
                    generatedAt: '2026-10-28T10:00:00Z',
                    revision: 'old-replay',
                },
            },
        }
        const view = emptyView()
        applyMatrix(view, matrix([mixed]), { label: 'mixed', path: 'mixed.json', generatedAt: '' })
        const at = '2026-10-28T12:00:00Z'
        const key = planned(hardware).key
        const events = parseProgress(
            [
                {
                    type: 'run-start',
                    version: 1,
                    runId: 'fresh-hardware',
                    at,
                    pid: process.pid,
                    source: 'hardware',
                    capabilities,
                    rows: [planned(hardware)],
                },
                {
                    type: 'capability',
                    runId: 'fresh-hardware',
                    at,
                    key,
                    capability: 'session',
                    status: 'pass',
                    detail: 'fresh physical session',
                    durationMilliseconds: 1,
                },
            ]
                .map(event => JSON.stringify(event))
                .join('\n')
        )
        applyRun(view, events, { alive: true })
        expect(view.rows[0].cells.session.evidence).toEqual({
            fidelity: 'hardware',
            profile: hardware.profile,
            generatedAt: at,
        })
        expect(renderDetailCellContents(view.rows[0].cells.session)).not.toContain('old-replay')
    })

    it('renders merged evidence on the camera page and avoids assigning USB host metadata to legacy network rows', () => {
        const merged = mixedEvidence()
        const directory = path.join(scratch, 'ui-evidence')
        mkdirSync(directory, { recursive: true })
        writeFileSync(path.join(directory, 'camera-compatibility.json'), JSON.stringify(merged))
        const data = new CompatData({ resultsDirectory: directory, runsDirectory: path.join(directory, 'runs') })
        const view = data.singleView('matrix:camera-compatibility.json')!
        const page = cameraPage(data, view, { base: '/', live: false }, 'sony-ilce-6700')
        expect(page.status).toBe(200)
        expect(page.html).toContain('cell-evidence')
        expect(page.html).toContain('simulation-revision')
        expect(page.html).toContain('firmware 1.00')
        expect(page.html).toContain('firmware 2.00')
        const networkCamera = merged.cameras.find(camera => camera.ptpIp)!
        delete networkCamera.ptpIp!.firmware
        Reflect.deleteProperty(networkCamera.ptpIp!, 'resultEvidence')
        networkCamera.host = 'USB-only-host'
        const network = rowsFromCompatibility(merged).rows.find(row => row.transport === 'ptp-ip')!
        expect(network.firmware).toBeUndefined()
        expect(network.host).toBeUndefined()
        const legacy = emptyView()
        applyMatrix(legacy, rowsFromCompatibility(merged), {
            label: 'legacy',
            path: 'legacy.json',
            generatedAt: merged.generatedAt,
        })
        const legacyNetwork = legacy.rows.find(row => row.transport === 'ptp-ip')!
        expect(legacyNetwork.cells.session.evidence).toBeUndefined()
        expect(renderRow(legacyNetwork, capabilities, { base: '/', live: false })).toContain('source unavailable')
    })
})

describe('audit evidence presentation boundaries', () => {
    it('keeps original observation time and separate firmware rows in combined hardware imports', () => {
        const view = emptyView()
        const first = matrixRow('sony-ilce-6700', {
            fidelity: 'hardware',
            firmware: '1.00',
            source: { generatedAt: '2020-01-01T00:00:00Z', revision: 'original' },
        })
        const second = matrixRow('sony-ilce-6700', {
            fidelity: 'hardware',
            firmware: '2.00',
            source: { generatedAt: '2021-01-01T00:00:00Z' },
        })
        applyMatrix(
            view,
            { ...matrix([first, second]), generatedAt: '2026-01-01T00:00:00Z' },
            { label: 'combined', path: 'combined.json', generatedAt: '2026-01-01T00:00:00Z' }
        )
        expect(view.rows).toHaveLength(2)
        const older = view.rows.find(row => row.firmware === '1.00')!
        expect(older.cells.session.evidence).toMatchObject({
            generatedAt: '2020-01-01T00:00:00Z',
            revision: 'original',
        })
        const stale = {
            ...first,
            source: { generatedAt: '2019-01-01T00:00:00Z' },
            results: results('fail', 'stale failure'),
        }
        applyMatrix(
            view,
            { ...matrix([stale]), generatedAt: '2028-01-01T00:00:00Z' },
            { label: 'reimport', path: 'reimport.json', generatedAt: '2028-01-01T00:00:00Z' }
        )
        expect(view.rows.find(row => row.firmware === '1.00')!.cells.session.detail).not.toBe('stale failure')
    })

    it('keeps network-only matrix entries as PTP/IP in rendered rows', () => {
        const row = matrixRow('nikon-z6-iii', { transport: 'ptp-ip', fidelity: 'documented' })
        const merged = mergeCompatibility(matrix([row]))
        const view = emptyView()
        applyMatrix(view, rowsFromCompatibility(merged), {
            label: 'network',
            path: 'network.json',
            generatedAt: merged.generatedAt,
        })
        expect(view.rows).toHaveLength(1)
        expect(view.rows[0].transport).toBe('ptp-ip')
        expect(renderRow(view.rows[0], capabilities, { base: '/', live: false })).toContain('PTP/IP')
    })

    it('shows conflicting evidence instead of presenting one tied source as the answer', () => {
        const one = matrixRow('nikon-z6-iii', {
            results: results('pass', 'one'),
            source: { generatedAt: '2026-01-01T00:00:00Z' },
        })
        const other = { ...one, results: results('fail', 'another') }
        const merged = mergeCompatibility(matrix([one, other]))
        const view = emptyView()
        applyMatrix(view, rowsFromCompatibility(merged), {
            label: 'conflict',
            path: 'conflict.json',
            generatedAt: merged.generatedAt,
        })
        expect(view.rows[0].cells.session.status).toBe('no-data')
        expect(renderRow(view.rows[0], capabilities, { base: '/', live: false })).toContain('conflict:')
    })
})

describe('validated compatibility metadata roundtrip', () => {
    const original = { generatedAt: '2020-01-01T00:00:00Z', revision: 'original-observation' }
    const evidence = { fidelity: 'captured' as const, profile: 'nikon-z6-iii', ...original, firmware: '2.00' }

    it('retains row and per-cell source times through file validation, API details and rewritten aggregate headers', () => {
        const directory = path.join(scratch, 'metadata-roundtrip')
        mkdirSync(directory, { recursive: true })
        const viewKey = 'captured/ptp-ip/nikon-z6-iii/Z6%20III/2.00'
        const row = {
            ...matrixRow('nikon-z6-iii', { transport: 'ptp-ip', firmware: '2.00', source: original }),
            viewKey,
            resultEvidence: {
                session: {
                    ...evidence,
                    conflicts: [
                        { ...evidence, status: 'pass', detail: 'one' },
                        { ...evidence, status: 'fail', detail: 'another' },
                    ],
                },
            },
        }
        const file = path.join(directory, 'camera-support-matrix.json')
        writeFileSync(file, JSON.stringify(matrix([row], '2026-10-28T12:00:00Z')))
        const data = new CompatData({ resultsDirectory: directory, runsDirectory: path.join(directory, 'runs') })
        const checked = data.readMatrix(file)!.rows[0] as ValidatedMatrixRow
        expect(checked.source).toEqual(original)
        expect(checked.viewKey).toBe(viewKey)
        expect(checked.resultEvidence?.session.conflicts).toHaveLength(2)
        const response = new CompatApi({ data }).camera('nikon-z6-iii')
        expect(response.rows[0]).toMatchObject({
            key: viewKey,
            transport: 'ptp-ip',
            firmware: '2.00',
            lastRun: original.generatedAt,
        })
        expect(response.rows[0].cells.session.at).toBe(original.generatedAt)
        expect(response.camera.results[0].cells.session.evidence).toMatchObject(evidence)
        expect(response.camera.results[0].cells.session.evidence?.conflicts).toHaveLength(2)
    })

    it('uses an older completed row source when replaying a newly written historical run log', () => {
        const row = matrixRow('nikon-z6-iii', { source: original })
        const key = planned(row).key
        const events = parseProgress(
            [
                {
                    type: 'run-start',
                    version: 1,
                    runId: 'historical-replay',
                    at: '2026-10-28T12:00:00Z',
                    pid: 0,
                    source: 'simulation',
                    capabilities,
                    rows: [planned(row)],
                },
                {
                    type: 'capability',
                    runId: 'historical-replay',
                    at: '2026-10-28T12:00:01Z',
                    key,
                    capability: 'session',
                    status: 'pass',
                    detail: 'old observation',
                    durationMilliseconds: 1,
                },
                { type: 'row-end', runId: 'historical-replay', at: '2026-10-28T12:00:02Z', key, row },
                { type: 'run-end', runId: 'historical-replay', at: '2026-10-28T12:00:03Z', outcome: 'completed' },
            ]
                .map(event => JSON.stringify(event))
                .join('\n')
        )
        const view = emptyView()
        applyRun(view, events, { alive: false })
        expect(view.rows[0].lastRun).toBe(original.generatedAt)
        expect(view.rows[0].cells.session).toMatchObject({
            at: original.generatedAt,
            evidence: { generatedAt: original.generatedAt, revision: original.revision },
        })
        const fresh = emptyView()
        applyMatrix(
            fresh,
            matrix([
                matrixRow('nikon-z6-iii', {
                    source: { generatedAt: '2021-01-01T00:00:00Z' },
                    results: results('fail', 'newer observation'),
                }),
            ]),
            { label: 'newer', path: 'newer.json', generatedAt: '2026-10-28T13:00:00Z' }
        )
        applyRun(fresh, events, { alive: false })
        expect(fresh.rows[0].cells.session).toMatchObject({
            status: 'fail',
            detail: 'newer observation',
            at: '2021-01-01T00:00:00Z',
        })
        const directory = path.join(scratch, 'historical-source-log')
        mkdirSync(path.join(directory, 'runs'), { recursive: true })
        writeFileSync(
            path.join(directory, 'runs', 'historical-replay.jsonl'),
            events.map(event => JSON.stringify(event)).join('\n') + '\n'
        )
        const data = new CompatData({ resultsDirectory: directory, runsDirectory: path.join(directory, 'runs') })
        expect(data.history(row.profile)[0].at).toBe(original.generatedAt)
    })

    it('keeps malformed supplied provenance unknown instead of using the fresh aggregate header', () => {
        const raw = {
            ...matrixRow('nikon-z6-iii'),
            source: { generatedAt: 'not-a-date' },
            resultEvidence: { session: { ...evidence, fidelity: 'invented' } },
        }
        const checked = matrixValue(matrix([raw], '2026-10-28T12:00:00Z'))!
        const view = emptyView()
        applyMatrix(view, checked, { label: 'malformed', path: 'bad.json', generatedAt: checked.generatedAt })
        expect(view.rows[0].lastRun).toBe('')
        expect(view.rows[0].cells.session.evidence).toBeUndefined()
        expect(renderDetailCellContents(view.rows[0].cells.session)).toContain('source unavailable')
    })

    it('bounds conflict records, removes nested/unsafe metadata and escapes imported source strings', () => {
        const entry = {
            ...evidence,
            profile: '<script>source</script>',
            conflicts: Array.from({ length: 65 }, () => ({
                ...evidence,
                status: 'fail',
                detail: '<img src=x onerror=run()>',
                conflicts: [evidence],
            })),
        }
        const raw = {
            ...matrixRow('nikon-z6-iii'),
            viewKey: 'captured/usb/another-profile/collision',
            resultEvidence: Object.fromEntries([
                ['session', entry],
                ['__proto__', evidence],
            ]),
        }
        const checked = matrixValue(matrix([raw]))!.rows[0] as ValidatedMatrixRow
        expect(checked.viewKey).toBeUndefined()
        expect(Object.hasOwn(checked.resultEvidence!, '__proto__')).toBe(false)
        expect(checked.resultEvidence!.session.conflicts).toHaveLength(32)
        expect(checked.resultEvidence!.session.conflicts![0]).not.toHaveProperty('conflicts')
        const view = emptyView()
        applyMatrix(view, matrix([checked]), { label: 'bounded', path: 'bounded.json', generatedAt: '' })
        expect(renderDetailCellContents(view.rows[0].cells.session)).not.toContain('<script>source</script>')
        expect(renderDetailCellContents(view.rows[0].cells.session)).toContain('&#60;script&#62;source')
    })

    it('retains primary PTP/IP transport through the merged-file backend adapter', () => {
        const directory = path.join(scratch, 'network-metadata-roundtrip')
        mkdirSync(directory, { recursive: true })
        const row = matrixRow('nikon-z6-iii', { transport: 'ptp-ip', source: original })
        const merged = mergeCompatibility(matrix([row], '2026-10-28T12:00:00Z'))
        writeFileSync(path.join(directory, 'camera-compatibility.json'), JSON.stringify(merged))
        const data = new CompatData({ resultsDirectory: directory, runsDirectory: path.join(directory, 'runs') })
        const response = new CompatApi({ data }).camera('nikon-z6-iii', 'matrix:camera-compatibility.json')
        expect(merged.cameras[0].primaryTransport).toBe('ptp-ip')
        expect(response.rows[0].transport).toBe('ptp-ip')
        expect(response.rows[0].lastRun).toBe(original.generatedAt)
        expect(response.camera.results[0].transport).toBe('ptp-ip')
        expect(response.camera.results[0].cells.session.evidence?.generatedAt).toBe(original.generatedAt)
    })
})
