/**
 * Loads the compatibility UI in Chromium against hostile result files and checks that nothing in them
 * runs as script, the page logs no errors, and the table, modal, legend, filters and live stream keep
 * working, including across a server restart. Needs a Playwright Chromium
 * (`bunx playwright install chromium`); run with `bun run test:ui`.
 */
import { CAPABILITIES } from '@scripts/camera-profiles/camera-capabilities'
import { CompatData } from '@scripts/compat-ui/compat-data'
import { startCompatServer, type RunningServer } from '@scripts/compat-ui/compat-server'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const capabilities = CAPABILITIES.map(({ id, label }) => ({ id, label }))
const scratch = mkdtempSync(path.join(tmpdir(), 'compat-browser-'))
const results = path.join(scratch, 'results')
const runs = path.join(results, 'compat-runs')

const INJECTIONS = [
    '<script>window.__pwned = 1</script>',
    '"><img src=x onerror="window.__pwned = 2">',
    "' onmouseover='window.__pwned = 3",
    '<svg onload="window.__pwned = 4"></svg>',
    '</td></tr></table><iframe src="javascript:window.__pwned = 5"></iframe>',
]
const HOSTILE_PROFILE = 'evil-"><img src=x onerror=window.__pwned=6>'

function hostileRow(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const injection = INJECTIONS[index % INJECTIONS.length]
    return {
        profile: `hostile-${index}`,
        path: `camera-profiles/${injection}`,
        manufacturer: index % 3 ? `Evil ${injection}` : '東京光学',
        line: `Line ${injection}`,
        model: `${injection} ${'📷'.repeat(index % 4)} ${'very long name '.repeat(index % 2 ? 20 : 1)}`,
        fidelity: ['hardware', 'captured', 'documented', 'simulated', null][index % 5],
        ...(index % 4 === 0 && { scope: 'line' }),
        transport: index % 2 ? 'ptp-ip' : 'carrier-pigeon',
        quirks: index % 6 ? { total: 2, simulated: 1, unverified: index % 2 } : null,
        results: Object.fromEntries(
            [...capabilities.map(capability => capability.id), 'x" onclick="window.__pwned=7'].map((id, position) => [
                id,
                (index + position) % 7 === 0
                    ? null
                    : {
                          status: ['pass', 'fail', 'unsupported', 'no-data', 'exploded', 7, '<b>'][
                              (index + position) % 7
                          ],
                          detail:
                              (index + position) % 5 === 0
                                  ? 'x'.repeat(50_000)
                                  : INJECTIONS[position % INJECTIONS.length],
                      },
            ])
        ),
        ...overrides,
    }
}

function writeFixtures(): void {
    mkdirSync(runs, { recursive: true })
    const rows = [
        ...Array.from({ length: 300 }, (_, index) => hostileRow(index)),
        hostileRow(300, { profile: HOSTILE_PROFILE }),
        { profile: 'missing-everything' },
        'not a row',
        null,
    ]
    writeFileSync(
        path.join(results, 'camera-support-matrix.json'),
        JSON.stringify({
            generatedAt: '2026-10-28T10:00:00.000Z',
            capabilities: [
                ...capabilities,
                { id: '"><img src=x onerror=window.__pwned=8>', label: INJECTIONS[0] },
                null,
                5,
            ],
            rows,
            lines: 'nope',
            totals: null,
            ptpIp: { notSimulated: [null, { manufacturer: INJECTIONS[1] }] },
        })
    )
    mkdirSync(path.join(results, 'camera-lab'), { recursive: true })
    writeFileSync(path.join(results, 'camera-lab', 'truncated.json'), '{"generatedAt":"2026","rows":[{"profile":"x"')
    const at = new Date().toISOString()
    const key = 'hardware/usb/hostile-live'
    const start = {
        type: 'run-start',
        version: 1,
        runId: 'live"><img src=x onerror=window.__pwned=9>',
        at,
        pid: process.pid,
        source: 'hardware',
        filter: INJECTIONS[2],
        capabilities,
        rows: [
            {
                key,
                profile: 'hostile-live',
                path: 'p',
                manufacturer: INJECTIONS[3],
                line: 'L',
                model: INJECTIONS[0],
                fidelity: 'hardware',
                transport: 'usb',
            },
        ],
    }
    writeFileSync(
        path.join(runs, 'live.jsonl'),
        [
            JSON.stringify(start),
            '{"type":"capability","runId":',
            'garbage \u0000 line',
            JSON.stringify({
                type: 'capability',
                runId: start.runId,
                at,
                key,
                capability: 'session',
                status: 'exploded',
                detail: INJECTIONS[1],
                durationMilliseconds: 'NaN',
            }),
            JSON.stringify({
                type: 'capability',
                runId: start.runId,
                at,
                key,
                capability: 'session',
                status: 'exploded',
                detail: INJECTIONS[1],
            }),
            JSON.stringify({
                type: 'capability-start',
                runId: start.runId,
                at,
                key,
                capability: `device-info${INJECTIONS[4]}`,
            }),
            JSON.stringify({ type: 'row-end', runId: start.runId, at, key }),
            '',
        ].join('\n')
    )
}

describe('compatibility UI in a browser', () => {
    let server: RunningServer
    let browser: Browser
    let port = 0
    const problems: string[] = []

    const start = async () => {
        server = await startCompatServer({
            port,
            data: new CompatData({ resultsDirectory: results, runsDirectory: runs }),
        })
        port = Number(new URL(server.url).port)
    }

    beforeAll(async () => {
        writeFixtures()
        await start()
        browser = await chromium.launch()
    }, 60_000)

    afterAll(async () => {
        await browser?.close()
        await server?.close()
        rmSync(scratch, { recursive: true, force: true })
    })

    async function openPage(route: string, colorScheme: 'light' | 'dark' = 'light'): Promise<Page> {
        const page = await browser.newPage({ colorScheme })
        page.on('console', message => {
            if (message.type() === 'error') problems.push(`${route}: console: ${message.text()}`)
        })
        page.on('pageerror', error => problems.push(`${route}: ${error.message}`))
        page.on('dialog', dialog => {
            problems.push(`${route}: a dialog opened: ${dialog.message()}`)
            void dialog.dismiss()
        })
        await page.goto(new URL(route, server.url).href, { waitUntil: 'load' })
        return page
    }

    async function expectNothingInjected(page: Page): Promise<void> {
        const state = await page.evaluate(() => ({
            pwned: (window as unknown as { __pwned?: number }).__pwned,
            images: document.querySelectorAll('img, iframe, svg:not(.i)').length,
            scripts: document.querySelectorAll('script').length,
            handlers: Array.from(document.querySelectorAll('*')).flatMap(element =>
                Array.from(element.attributes)
                    .filter(attribute => attribute.name.startsWith('on'))
                    .map(attribute => attribute.name)
            ),
        }))
        expect(state).toEqual({ pwned: undefined, images: 0, scripts: 1, handlers: [] })
    }

    it('renders hostile results as text, with icons for unknown values', async () => {
        const page = await openPage('/')
        await page.waitForSelector('#rows tr[data-profile="hostile-1"]')
        await page.mouse.move(400, 300)
        await page.hover('#rows tr:nth-child(3) td.model')
        await expectNothingInjected(page)
        expect(await page.locator('#rows tr').count()).toBeGreaterThan(300)
        expect(await page.locator('#rows i.i-unknown').count()).toBeGreaterThan(0)
        expect(await page.textContent('#rows')).not.toMatch(/undefined|NaN/)
        expect(await page.locator('.run-progress').count()).toBe(1)

        await page.click('#toggle-status-filters')
        await page.selectOption('select[name="session"]', 'unknown')
        await page.waitForFunction(() => location.search.includes('session=unknown'))
        await page.fill('input[name="q"]', INJECTIONS[1])
        await page.waitForFunction(() => location.search.includes('q='))
        await page.goBack()
        await page.click('#legend summary')
        expect(await page.isVisible('.legend-panel')).toBe(true)
        await expectNothingInjected(page)
        await page.close()
    }, 60_000)

    it('opens a deep-linkable modal that Escape, the backdrop and back close, restoring focus', async () => {
        const page = await openPage('/')
        await page.waitForSelector('#rows tr[data-profile="hostile-2"]')
        await page.click('#rows tr[data-profile="hostile-2"] td.time')
        await page.waitForSelector('#camera-modal[open] #camera-title')
        expect(new URL(page.url()).searchParams.get('camera')).toBe('hostile-2')
        await page.keyboard.press('Escape')
        await page.waitForSelector('#camera-modal:not([open])', { state: 'attached' })
        expect(new URL(page.url()).searchParams.get('camera')).toBeNull()
        expect(await page.evaluate(() => document.activeElement?.closest('tr')?.dataset.profile)).toBe('hostile-2')

        await page.click('#rows tr[data-profile="hostile-3"] a.open')
        await page.waitForSelector('#camera-modal[open] #camera-title')
        await page.goBack()
        await page.waitForSelector('#camera-modal:not([open])', { state: 'attached' })
        await page.goForward()
        await page.waitForSelector('#camera-modal[open] #camera-title')
        await page.mouse.click(5, 5)
        await page.waitForSelector('#camera-modal:not([open])', { state: 'attached' })

        await page.goto(new URL(`/?camera=${encodeURIComponent(HOSTILE_PROFILE)}`, server.url).href)
        await page.waitForSelector('#camera-modal[open] #camera-detail')
        await expectNothingInjected(page)
        // A deep link to a profile that does not exist shows a message; its 404 is the only error logged.
        const before = problems.length
        await page.goto(new URL('/?camera=no-such-profile', server.url).href)
        await page.waitForSelector('#camera-modal[open] .muted')
        expect(await page.textContent('#modal-body')).toContain('no-such-profile')
        expect(problems.splice(before).every(problem => problem.includes('404'))).toBe(true)
        await page.close()
    }, 60_000)

    it('renders every other page against the same files, in both themes', async () => {
        for (const route of [
            '/runs',
            '/gaps',
            '/camera/hostile-1',
            `/camera/${encodeURIComponent(HOSTILE_PROFILE)}`,
            '/m/unknown',
            '/?run=live',
        ]) {
            for (const scheme of ['light', 'dark'] as const) {
                const page = await openPage(route, scheme)
                await page.waitForLoadState('domcontentloaded')
                await expectNothingInjected(page)
                await page.close()
            }
        }
    }, 60_000)

    it('recovers when the live stream drops and the server comes back', async () => {
        const page = await openPage('/')
        await page.waitForSelector('#rows tr[data-profile="hostile-1"]')
        await page.waitForFunction(() => document.getElementById('live-status')?.textContent?.startsWith('live'))
        const before = problems.length
        await server.close()
        await page.waitForFunction(() => document.getElementById('live-status')?.textContent?.includes('reconnecting'))
        // The run moves on while the server is down; the page must pick that up after reconnecting.
        writeFileSync(
            path.join(runs, 'second.jsonl'),
            `${JSON.stringify({ type: 'run-start', version: 1, runId: 'second', at: new Date().toISOString(), pid: process.pid, source: 'simulation', capabilities, rows: [{ key: 'captured/usb/after-restart', profile: 'after-restart', path: 'p', manufacturer: 'Canon', line: 'EOS R', model: 'After Restart', fidelity: 'captured', transport: 'usb' }] })}\n`
        )
        await start()
        await page.waitForSelector('#rows tr[data-profile="after-restart"]', { timeout: 20_000 })
        await page.waitForFunction(() => document.getElementById('live-status')?.textContent?.startsWith('live'))
        // Connection errors while the server was down are expected; nothing else may be logged.
        problems.splice(
            before,
            problems.length - before,
            ...problems.slice(before).filter(problem => !/ERR_CONNECTION_REFUSED|events/.test(problem))
        )
        await expectNothingInjected(page)
        await page.close()
    }, 60_000)

    it('logged no console errors or page errors', () => {
        expect(problems).toEqual([])
    })
})
