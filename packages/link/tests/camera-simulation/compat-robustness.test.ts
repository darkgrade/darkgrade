/**
 * Property tests for the compatibility UI's data layer and rendering: whatever a result file, run log
 * or request holds (malformed or partial lines, unknown statuses, missing fields, null and NaN, huge
 * or hostile strings, unicode, duplicate and out-of-order events, truncation, files vanishing), the
 * data layer must not throw, and the HTML must not let any of it become markup.
 */
import { CAPABILITIES } from '@scripts/camera-profiles/camera-capabilities'
import { parseProgress } from '@scripts/camera-profiles/compat-progress'
import { matrixValue } from '@scripts/camera-profiles/compat-schema'
import { CompatData } from '@scripts/compat-ui/compat-data'
import { applyFilters, parseFilters } from '@scripts/compat-ui/compat-filters'
import { iconStylesheet } from '@scripts/compat-ui/compat-icons'
import {
    renderCameraDetail,
    renderCounts,
    renderProgress,
    renderRow,
    renderTablePage,
    type CameraDetailModel,
    type PageContext,
} from '@scripts/compat-ui/compat-pages'
import { startCompatServer } from '@scripts/compat-ui/compat-server'
import { cameraDetailModel, routePage } from '@scripts/compat-ui/compat-site'
import { applyMatrix, applyRun, CELL_STATUSES, emptyView, type CompatView } from '@scripts/compat-ui/compat-view'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const scratch = mkdtempSync(path.join(tmpdir(), 'compat-robustness-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const context: PageContext = { base: '/', live: true }
const capabilities = CAPABILITIES.map(({ id, label }) => ({ id, label }))

/** A small deterministic generator (mulberry32), so a failure reproduces from its seed. */
function generator(seed: number) {
    let state = seed
    const next = () => {
        state = (state + 0x6d2b79f5) | 0
        let value = Math.imul(state ^ (state >>> 15), 1 | state)
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
    return {
        next,
        integer: (maximum: number) => Math.floor(next() * maximum),
        pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
        chance: (probability: number) => next() < probability,
    }
}

const HOSTILE_TEXT = [
    '<script>window.__pwned=1</script>',
    '"><img src=x onerror=window.__pwned=1>',
    "' onmouseover='window.__pwned=1",
    '</td></tr></table><b>broken</b>',
    '<svg/onload=window.__pwned=1>',
    'javascript:window.__pwned=1',
    '&amp;&lt;&#60;',
    '‮evil\u0000nul',
    '📷 Z6 Ⅲ 🎞',
    '東京光学',
    '',
    ' ',
    'x'.repeat(20_000),
    '__proto__',
    'constructor',
]
const HOSTILE_VALUES: unknown[] = [
    ...HOSTILE_TEXT,
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0,
    1e308,
    true,
    {},
    [],
    [null],
    { nested: { deeper: '<b>' } },
]
const STATUSES: unknown[] = ['pass', 'fail', 'unsupported', 'no-data', 'exploded', 'PASS', '', null, 7, '<b>x</b>']
const FIDELITY_VALUES: unknown[] = ['hardware', 'captured', 'documented', 'simulated', '<i>', null, 3]

type Random = ReturnType<typeof generator>

/** A value that is usually what the field should hold and sometimes anything at all. */
function maybe(random: Random, good: unknown): unknown {
    return random.chance(0.75) ? good : random.pick(HOSTILE_VALUES)
}

function hostileRow(random: Random, index: number): Record<string, unknown> {
    const capabilityIds = [...capabilities.map(capability => capability.id), random.pick(HOSTILE_TEXT)]
    const row: Record<string, unknown> = {
        profile: maybe(random, `profile-${index}`),
        path: maybe(random, `camera-profiles/x/${index}.json`),
        manufacturer: maybe(random, random.pick(['Canon', 'Nikon', '<b>Evil</b> Corp', '東京光学', ''])),
        line: maybe(random, random.pick(['EOS R', 'Z', '"><img src=x onerror=window.__pwned=1>'])),
        model: maybe(random, random.pick(HOSTILE_TEXT.concat(['EOS R5', 'Z6 III']))),
        fidelity: random.pick(FIDELITY_VALUES),
        scope: maybe(random, random.pick(['line', 'model', '<script>'])),
        transport: maybe(random, random.pick(['usb', 'ptp-ip', 'carrier-pigeon'])),
        usb: maybe(random, ['04a9:3323', random.pick(HOSTILE_VALUES)]),
        quirks: maybe(random, { total: 1, simulated: 1, unverified: random.pick([0, 1, -3, Number.NaN, '2']) }),
        results: maybe(
            random,
            Object.fromEntries(
                capabilityIds.map(id => [
                    id,
                    maybe(random, { status: random.pick(STATUSES), detail: maybe(random, random.pick(HOSTILE_TEXT)) }),
                ])
            )
        ),
    }
    if (random.chance(0.1)) delete row[random.pick(Object.keys(row))]
    return row
}

function hostileMatrix(random: Random, rows: number): Record<string, unknown> {
    return {
        generatedAt: maybe(random, '2026-10-28T10:00:00.000Z'),
        capabilities: maybe(random, [
            ...capabilities,
            { id: random.pick(HOSTILE_TEXT), label: random.pick(HOSTILE_TEXT) },
            random.pick(HOSTILE_VALUES),
        ]),
        rows: Array.from({ length: rows }, (_, index) => hostileRow(random, index)),
        lines: maybe(random, []),
        totals: maybe(random, {}),
        ptpIp: maybe(random, {
            simulated: 1,
            notSimulated: [{ manufacturer: 'Canon', line: random.pick(HOSTILE_TEXT) }, null],
        }),
        catalogModels: maybe(random, { skipped: [random.pick(HOSTILE_VALUES)] }),
    }
}

const RUN_ID = 'fuzz-run'

function hostileEvents(random: Random, count: number): unknown[] {
    const keys = [
        'documented/usb/profile-1',
        'captured/usb/profile-2',
        'hardware/ptp-ip/<b>',
        random.pick(HOSTILE_TEXT),
    ]
    const start = {
        type: 'run-start',
        version: 1,
        runId: RUN_ID,
        at: '2026-10-28T11:00:00.000Z',
        pid: maybe(random, process.pid),
        source: maybe(random, 'simulation'),
        filter: maybe(random, 'manufacturer=canon'),
        capabilities: maybe(random, capabilities),
        rows: maybe(
            random,
            keys.map((key, index) => ({ ...hostileRow(random, index), key }))
        ),
    }
    const events: unknown[] = [start]
    for (let index = 0; index < count; index += 1) {
        const key = random.pick(keys)
        const capability = random.pick([...capabilities.map(entry => entry.id), random.pick(HOSTILE_TEXT)])
        const at = `2026-10-28T11:${String(random.integer(60)).padStart(2, '0')}:00.000Z`
        const runId = random.chance(0.05) ? 'another-run' : RUN_ID
        const event = random.pick([
            { type: 'capability-start', runId, at, key, capability },
            {
                type: 'capability',
                runId,
                at,
                key,
                capability,
                status: random.pick(STATUSES),
                detail: maybe(random, random.pick(HOSTILE_TEXT)),
                durationMilliseconds: maybe(random, 12),
            },
            { type: 'row-end', runId, at, key, row: maybe(random, hostileRow(random, index)) },
            { type: random.pick(['mystery', null, 42]), runId, at },
        ])
        events.push(random.chance(0.85) ? event : random.pick(HOSTILE_VALUES))
        // Duplicates and out-of-order lines, as a retried or interleaved writer produces.
        if (random.chance(0.1)) events.push(event)
        if (random.chance(0.05)) events.splice(random.integer(events.length), 0, event)
    }
    if (random.chance(0.3))
        events.push({
            type: 'run-end',
            runId: RUN_ID,
            at: '2026-10-28T12:00:00.000Z',
            outcome: random.pick(['completed', 'failed', '<b>']),
        })
    return events
}

/** Serializes events as a run log, with some lines corrupted or cut short. */
function hostileLog(random: Random, events: unknown[]): string {
    return events
        .map(event => {
            const line = JSON.stringify(event) ?? 'undefined'
            if (random.chance(0.05)) return line.slice(0, random.integer(line.length))
            if (random.chance(0.03)) return '\u0000ÿ garbage {{{'
            return line
        })
        .join('\n')
}

const ALLOWED_TAGS = new Set(
    'html head meta title link script body header nav main a span i table thead tbody tr th td div p strong b code h1 h2 h3 select option input label form button noscript details summary ul li ol blockquote dl dt dd article dialog'.split(
        ' '
    )
)

const TAG = /<([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:="[^"<>]*")?)*)\s*>/y

/**
 * Fails when text from a file became markup: every tag must be well-formed with double-quoted
 * attribute values, be one the renderers emit, carry no event handler, and add no script.
 */
function expectSafeHtml(html: string, scripts: number): void {
    const problems: string[] = []
    let scriptTags = 0
    for (const start of html.matchAll(/<[a-zA-Z]/g)) {
        const position = start.index ?? 0
        TAG.lastIndex = position
        const tag = TAG.exec(html)
        if (!tag) {
            problems.push(`malformed tag at ${html.slice(position, position + 80)}`)
            continue
        }
        const [, name, attributes] = tag
        const lower = name.toLowerCase()
        if (lower === 'script') scriptTags += 1
        if (!ALLOWED_TAGS.has(lower)) problems.push(`<${name}>`)
        for (const [, attribute, value] of attributes.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g)) {
            if (attribute.toLowerCase().startsWith('on')) problems.push(`${attribute} on <${name}>`)
            if (attribute === 'href' && /^\s*javascript:/i.test(value ?? '')) problems.push(`href=${value}`)
        }
    }
    if (scriptTags !== scripts) problems.push(`${scriptTags} script tags`)
    // The gaps page says "undefined vendor operations"; anything else is a value that went missing.
    const leaked = /\b(?:undefined(?! vendor operations)|NaN)\b/.exec(html)
    if (leaked) problems.push(`leaked: ${html.slice(Math.max(0, leaked.index - 160), leaked.index + 60)}`)
    expect(problems).toEqual([])
}

function viewFrom(random: Random): CompatView {
    const view = emptyView()
    applyMatrix(view, hostileMatrix(random, 12) as never, { label: '<b>matrix</b>', path: 'm.json', generatedAt: '' })
    applyRun(view, parseProgress(hostileLog(random, hostileEvents(random, 40))), { alive: random.chance(0.5) })
    return view
}

describe('result file parsing', () => {
    it('keeps only well-formed events from any run log', () => {
        for (let seed = 1; seed <= 300; seed += 1) {
            const random = generator(seed)
            const events = parseProgress(hostileLog(random, hostileEvents(random, 30)))
            for (const event of events) {
                expect(['run-start', 'capability-start', 'capability', 'row-end', 'run-end']).toContain(event.type)
                expect(typeof event.runId).toBe('string')
                expect(typeof event.at).toBe('string')
                if (event.type === 'capability') {
                    expect(typeof event.detail).toBe('string')
                    expect(Number.isFinite(event.durationMilliseconds)).toBe(true)
                }
                if (event.type === 'run-start') {
                    expect(Array.isArray(event.rows)).toBe(true)
                    expect(Array.isArray(event.capabilities)).toBe(true)
                    for (const row of event.rows) expect(typeof row.model).toBe('string')
                }
            }
        }
    })

    it('reads any matrix as rows with text identities, or not at all', () => {
        for (let seed = 1; seed <= 200; seed += 1) {
            const random = generator(seed)
            const matrix = matrixValue(random.chance(0.1) ? random.pick(HOSTILE_VALUES) : hostileMatrix(random, 8))
            for (const row of matrix?.rows ?? []) {
                for (const field of ['profile', 'path', 'manufacturer', 'line', 'model'] as const) {
                    expect(typeof row[field]).toBe('string')
                    expect(row[field].length).toBeLessThanOrEqual(400)
                }
                expect(Number.isInteger(row.quirks.unverified) && row.quirks.unverified >= 0).toBe(true)
                expect(Object.getPrototypeOf(row.results)).toBe(Object.prototype)
            }
        }
    })
})

describe('view model', () => {
    it('never throws, keeps progress within bounds and every status displayable', () => {
        for (let seed = 1; seed <= 300; seed += 1) {
            const random = generator(seed)
            const view = emptyView()
            applyMatrix(view, hostileMatrix(random, 6) as never, { label: 'm', path: 'm.json', generatedAt: '' })
            const { summary } = applyRun(view, hostileEvents(random, 40) as never, { alive: random.chance(0.6) })
            if (summary) {
                expect(summary.finishedCells).toBeLessThanOrEqual(summary.cells)
                const counted = Object.values(summary.counts).reduce((total, count) => total + count, 0)
                expect(counted).toBe(summary.finishedCells)
            }
            for (const row of view.rows) {
                expect(row.manufacturerSlug).toMatch(/^[a-z0-9-]+$/)
                expect(row.lineSlug).toMatch(/^[a-z0-9-]+$/)
                for (const cell of Object.values(row.cells)) expect(CELL_STATUSES).toContain(cell.status)
            }
            expect(() =>
                applyFilters(
                    view.rows,
                    parseFilters(
                        `sort=${random.pick(['fidelity', 'model', 'session', '__proto__'])}&order=desc&q=${encodeURIComponent(random.pick(HOSTILE_TEXT))}`,
                        ['session']
                    )
                )
            ).not.toThrow()
        }
    })

    it('counts a duplicated result once and does not reopen a finished cell', () => {
        const start = {
            type: 'run-start',
            version: 1,
            runId: 'r',
            at: 'a',
            pid: 1,
            source: 'simulation',
            capabilities: [{ id: 'session', label: 'Session' }],
            rows: [
                {
                    key: 'k',
                    profile: 'p',
                    path: 'p',
                    manufacturer: 'M',
                    line: 'L',
                    model: 'm',
                    fidelity: 'captured',
                    transport: 'usb',
                },
            ],
        }
        const result = {
            type: 'capability',
            runId: 'r',
            at: 'b',
            key: 'k',
            capability: 'session',
            status: 'pass',
            detail: '',
            durationMilliseconds: 1,
        }
        const view = emptyView()
        const { summary } = applyRun(
            view,
            [
                start,
                result,
                result,
                result,
                { type: 'capability-start', runId: 'r', at: 'c', key: 'k', capability: 'session' },
            ] as never,
            { alive: true }
        )
        expect(summary).toMatchObject({ finishedCells: 1, cells: 1, counts: { pass: 1 } })
        expect(view.rows[0].cells.session?.status).toBe('pass')
        expect(summary?.current).toBeUndefined()
    })
})

describe('rendering', () => {
    it('escapes everything a file can hold, in rows, counts, progress, pages and camera details', () => {
        for (let seed = 1; seed <= 120; seed += 1) {
            const random = generator(seed)
            const view = viewFrom(random)
            const rows = view.rows.map(row => renderRow(row, view.capabilities, context)).join('')
            expectSafeHtml(rows, 0)
            expectSafeHtml(renderCounts(view.rows, view.rows.length), 0)
            expectSafeHtml(renderProgress(view.activeRun ?? view.runs[0], context), 0)
            const page = renderTablePage(context, {
                view,
                rows: view.rows,
                filters: parseFilters(
                    `q=${encodeURIComponent(random.pick(HOSTILE_TEXT))}&sort=${encodeURIComponent(random.pick(HOSTILE_TEXT))}`,
                    []
                ),
                route: {},
                manufacturers: view.rows.map(row => ({ slug: row.manufacturerSlug, name: row.manufacturer, rows: 1 })),
                lines: [],
            })
            expectSafeHtml(page, 1)
            const row = view.rows[0]
            if (!row) continue
            const detail: CameraDetailModel = {
                profileId: row.profile,
                model: row.model,
                manufacturer: row.manufacturer,
                manufacturerSlug: row.manufacturerSlug,
                line: row.line,
                lineSlug: row.lineSlug,
                fidelity: row.fidelity,
                path: row.path,
                usb: { productIds: [], identities: [random.pick(HOSTILE_TEXT)] },
                transports: [row.transport, random.pick(HOSTILE_TEXT)],
                unverified: true,
                unverifiedQuirks: Number.NaN,
                firmware: random.pick(HOSTILE_TEXT),
                catalogEntry: {
                    source: random.pick(HOSTILE_TEXT),
                    gphotoFlags: [random.pick(HOSTILE_TEXT)],
                    unverified: true,
                },
                capabilities: view.capabilities,
                results: [
                    {
                        key: row.key,
                        fidelity: row.fidelity,
                        transport: random.pick(HOSTILE_TEXT),
                        label: random.pick(HOSTILE_TEXT),
                        source: random.pick(HOSTILE_TEXT),
                        at: random.pick(HOSTILE_TEXT),
                        cells: row.cells as CameraDetailModel['results'][number]['cells'],
                    },
                ],
                related: [
                    {
                        profile: random.pick(HOSTILE_TEXT),
                        model: random.pick(HOSTILE_TEXT),
                        fidelity: random.pick(HOSTILE_TEXT),
                        path: random.pick(HOSTILE_TEXT),
                    },
                ],
                quirks: [
                    {
                        id: random.pick(HOSTILE_TEXT),
                        description: random.pick(HOSTILE_TEXT),
                        behaviour: random.pick(HOSTILE_TEXT),
                        unverified: true,
                        source: 0,
                    },
                ],
                exchanges: [
                    {
                        operation: random.pick(HOSTILE_TEXT),
                        parameters: '[]',
                        response: random.pick(HOSTILE_TEXT),
                        note: random.pick(HOSTILE_TEXT),
                        source: 9,
                    },
                ],
                exchangeCount: 1,
                sources: [
                    {
                        location: random.pick([
                            'javascript:window.__pwned=1',
                            'https://example.com/"><b>',
                            random.pick(HOSTILE_TEXT),
                        ]),
                        excerpt: random.pick(HOSTILE_TEXT),
                    },
                ],
                history: [
                    {
                        runId: random.pick(HOSTILE_TEXT),
                        source: 'simulation',
                        at: random.pick(HOSTILE_TEXT),
                        label: random.pick(HOSTILE_TEXT),
                        cells: {},
                    },
                ],
                ...(view.activeRun && { activeRun: view.activeRun }),
            }
            expectSafeHtml(renderCameraDetail(context, detail, 2), 0)
        }
    })

    it('draws every icon from well-formed SVG', () => {
        for (const rule of iconStylesheet().split('\n')) {
            const svg = decodeURIComponent(rule.match(/data:image\/svg\+xml,([^"]+)"/)![1])
            for (const element of svg.matchAll(/<\w+([^>]*)>/g)) {
                const names = [...element[1].matchAll(/([\w-]+)=/g)].map(match => match[1])
                expect(new Set(names).size, `${rule.slice(0, 20)}: ${element[0]}`).toBe(names.length)
            }
        }
    })

    it('renders and filters thousands of rows quickly', () => {
        const random = generator(7)
        const matrix = {
            generatedAt: '2026-10-28T10:00:00.000Z',
            capabilities,
            rows: Array.from({ length: 6000 }, (_, index) => ({
                profile: `profile-${index}`,
                path: `p/${index}`,
                manufacturer: random.pick(['Canon', 'Nikon', 'Sony', 'Fujifilm']),
                line: random.pick(['A', 'B', 'C']),
                model: `Model ${index}`,
                fidelity: random.pick(['captured', 'documented', 'hardware']),
                quirks: { total: 0, simulated: 0, unverified: 0 },
                results: Object.fromEntries(
                    capabilities.map(({ id }) => [
                        id,
                        { status: random.pick(['pass', 'fail', 'no-data']), detail: 'x'.repeat(80) },
                    ])
                ),
            })),
            lines: [],
            totals: {},
        }
        const view = emptyView()
        const startedAt = performance.now()
        applyMatrix(view, matrix as never, { label: 'm', path: 'm.json', generatedAt: '' })
        const rows = applyFilters(view.rows, parseFilters('sort=session&order=desc', ['session']))
        const html = rows.map(row => renderRow(row, view.capabilities, context)).join('')
        expect(rows).toHaveLength(6000)
        expect(html.length).toBeGreaterThan(1000)
        expect(performance.now() - startedAt).toBeLessThan(5_000)
    })
})

describe('result files on disk', () => {
    it('serves every page from a directory of corrupt, truncated and hostile files', () => {
        for (let seed = 1; seed <= 12; seed += 1) {
            const random = generator(seed)
            const directory = path.join(scratch, `disk-${seed}`)
            const runs = path.join(directory, 'compat-runs')
            mkdirSync(path.join(directory, 'camera-lab'), { recursive: true })
            mkdirSync(path.join(directory, 'compat-imports'), { recursive: true })
            mkdirSync(runs, { recursive: true })
            const matrixText = JSON.stringify(hostileMatrix(random, 10))
            writeFileSync(
                path.join(directory, 'camera-support-matrix.json'),
                random.chance(0.3) ? matrixText.slice(0, random.integer(matrixText.length)) : matrixText
            )
            writeFileSync(path.join(directory, 'camera-lab', 'a.json'), JSON.stringify(hostileMatrix(random, 2)))
            writeFileSync(path.join(directory, 'camera-lab', 'b.json'), '\u0000not json')
            writeFileSync(
                path.join(directory, 'compat-imports', 'c.json'),
                JSON.stringify(random.pick(HOSTILE_VALUES)) ?? ''
            )
            writeFileSync(
                path.join(directory, 'camera-compatibility.json'),
                JSON.stringify({ cameras: [null, { results: 5 }] })
            )
            for (let index = 0; index < 3; index += 1) {
                writeFileSync(path.join(runs, `run-${index}.jsonl`), hostileLog(random, hostileEvents(random, 25)))
            }
            const data = new CompatData({ resultsDirectory: directory, runsDirectory: runs })
            const view = data.view()
            const routes = [
                '/',
                '/runs',
                '/gaps',
                '/m/canon',
                '/m/%E0%A4%A',
                '/camera/%3Cscript%3E',
                '/camera/%E0%A4%A',
                ...view.rows.map(row => `/camera/${encodeURIComponent(row.profile)}`),
                ...view.rows.map(row => `/m/${row.manufacturerSlug}/${row.lineSlug}`),
            ]
            for (const route of routes) {
                const page = routePage(
                    data,
                    context,
                    route,
                    random.chance(0.5)
                        ? ''
                        : `?run=${encodeURIComponent(random.pick([...HOSTILE_TEXT, 'run-0', 'matrix:camera-lab/a.json']))}&camera=x`
                )
                expect([200, 400, 404]).toContain(page.status)
                expectSafeHtml(page.html, 1)
            }
            for (const row of view.rows) expect(() => cameraDetailModel(data, view, row.profile)).not.toThrow()
            expect(() => data.gapReport()).not.toThrow()
        }
    })

    it('follows a growing log, a truncated rewrite and a file that disappears', () => {
        const random = generator(99)
        const runs = path.join(scratch, 'growing')
        mkdirSync(runs, { recursive: true })
        const file = path.join(runs, 'growing.jsonl')
        const text = `${hostileLog(random, hostileEvents(random, 60))}\n`
        writeFileSync(file, '')
        const data = new CompatData({ resultsDirectory: path.join(scratch, 'growing-results'), runsDirectory: runs })
        // Written in uneven chunks, so reads often land mid-line (a writer that has not finished a line).
        for (let offset = 0; offset < text.length;) {
            const next = Math.min(text.length, offset + 1 + random.integer(400))
            appendFileSync(file, text.slice(offset, next))
            offset = next
            data.readRun(file)
        }
        expect(data.readRun(file)).toEqual(parseProgress(text))
        const shorter = text.slice(0, Math.floor(text.length / 3))
        writeFileSync(file, shorter.slice(0, shorter.lastIndexOf('\n') + 1))
        expect(data.readRun(file)).toEqual(parseProgress(shorter.slice(0, shorter.lastIndexOf('\n') + 1)))
        const listed = data.runFiles()
        rmSync(file)
        expect(() => data.view()).not.toThrow()
        expect(() => data.readRun(listed[0].file)).not.toThrow()
    })

    it('treats a log without a usable pid as not running', () => {
        const runs = path.join(scratch, 'no-pid')
        mkdirSync(runs, { recursive: true })
        writeFileSync(
            path.join(runs, 'r.jsonl'),
            `${JSON.stringify({ type: 'run-start', runId: 'r', at: new Date().toISOString(), pid: 'abc', capabilities, rows: [] })}\n`
        )
        const view = new CompatData({
            resultsDirectory: path.join(scratch, 'no-pid-results'),
            runsDirectory: runs,
        }).view()
        expect(view.activeRun).toBeUndefined()
        expect(view.runs[0]?.outcome).toBe('stopped')
    })
})

describe('live server under failures', () => {
    it('keeps serving and streaming when reading results fails, and picks up again afterwards', async () => {
        const directory = path.join(scratch, 'live')
        const runs = path.join(directory, 'compat-runs')
        mkdirSync(runs, { recursive: true })
        const data = new CompatData({ resultsDirectory: directory, runsDirectory: runs })
        const server = await startCompatServer({ port: 0, data })
        const controller = new AbortController()
        try {
            const stream = await fetch(new URL('/api/v1/events', server.url), { signal: controller.signal })
            const reader = stream.body!.getReader()
            const received: string[] = []
            void (async () => {
                for (;;) {
                    const { value, done } = await reader.read()
                    if (done) return
                    received.push(new TextDecoder().decode(value))
                }
            })().catch(() => undefined)
            const view = data.view.bind(data)
            let failing = true
            data.view = () => {
                if (failing) throw new Error('disk went away')
                return view()
            }
            const at = new Date().toISOString()
            writeFileSync(
                path.join(runs, 'live.jsonl'),
                `${JSON.stringify({ type: 'run-start', version: 1, runId: 'live', at, pid: process.pid, source: 'simulation', capabilities, rows: [] })}\n`
            )
            await new Promise(resolve => setTimeout(resolve, 1_600))
            expect((await fetch(new URL('/api/v1/status', server.url))).status).toBe(500)
            failing = false
            appendFileSync(path.join(runs, 'live.jsonl'), '\n')
            await new Promise(resolve => setTimeout(resolve, 1_600))
            expect((await fetch(server.url)).status).toBe(200)
            expect(received.join('')).toContain('"runId":"live"')
        } finally {
            controller.abort()
            await server.close()
        }
    }, 20_000)

    it('shows the same run after a server restart, then its end', async () => {
        const directory = path.join(scratch, 'restart')
        const runs = path.join(directory, 'compat-runs')
        mkdirSync(runs, { recursive: true })
        const file = path.join(runs, 'restart.jsonl')
        const at = new Date().toISOString()
        const rows = [
            {
                key: 'captured/usb/p',
                profile: 'p',
                path: 'p',
                manufacturer: 'M',
                line: 'L',
                model: 'm',
                fidelity: 'captured',
                transport: 'usb',
            },
        ]
        const result = (capability: string) =>
            `${JSON.stringify({ type: 'capability', runId: 'restart', at, key: 'captured/usb/p', capability, status: 'pass', detail: 'ok', durationMilliseconds: 1 })}\n`
        writeFileSync(
            file,
            `${JSON.stringify({ type: 'run-start', version: 1, runId: 'restart', at, pid: process.pid, source: 'simulation', capabilities, rows })}\n${result('session')}`
        )
        const status = async (url: string) =>
            (await (await fetch(new URL('/api/v1/status', url))).json()) as { activeRun?: { finishedCells: number } }
        const first = await startCompatServer({
            port: 0,
            data: new CompatData({ resultsDirectory: directory, runsDirectory: runs }),
        })
        expect((await status(first.url)).activeRun?.finishedCells).toBe(1)
        await first.close()
        appendFileSync(file, result('device-info'))
        const second = await startCompatServer({
            port: 0,
            data: new CompatData({ resultsDirectory: directory, runsDirectory: runs }),
        })
        try {
            expect((await status(second.url)).activeRun?.finishedCells).toBe(2)
            appendFileSync(file, `${JSON.stringify({ type: 'run-end', runId: 'restart', at, outcome: 'completed' })}\n`)
            expect((await status(second.url)).activeRun).toBeUndefined()
        } finally {
            await second.close()
        }
    }, 30_000)
})
