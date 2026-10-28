/**
 * Routes of the compatibility UI, shared by the local server and the static export:
 *
 *   /                          every row
 *   /m/<manufacturer>          one manufacturer, with its lines
 *   /m/<manufacturer>/<line>   one line
 *   /camera/<profile id>       identity, results per tier and link, quirks, provenance, run history
 *   /runs                      run logs and result files
 *   /gaps                      darkgrade library and data gaps
 *
 * Filters and sorting are query parameters (see compat-filters.ts).
 */
import type { CompatData } from './compat-data'
import { applyFilters, parseFilters } from './compat-filters'
import {
    citation,
    escapeHtml,
    renderCameraPage,
    renderGapsPage,
    renderNotFound,
    renderRunsPage,
    renderTablePage,
    type PageContext,
} from './compat-pages'
import type { CellStatus, CompatView, ViewRow } from './compat-view'

export interface PageResult {
    status: number
    html: string
}

function groupCounts(rows: ViewRow[], pick: (row: ViewRow) => [string, string]) {
    const counts = new Map<string, { slug: string; name: string; rows: number }>()
    for (const row of rows) {
        const [key, name] = pick(row)
        const entry = counts.get(key) ?? { slug: key, name, rows: 0 }
        entry.rows += 1
        counts.set(key, entry)
    }
    return [...counts.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function manufacturersOf(view: CompatView) {
    return groupCounts(view.rows, row => [row.manufacturerSlug, row.manufacturer])
}

export function linesOf(view: CompatView, manufacturer: string) {
    return groupCounts(
        view.rows.filter(row => row.manufacturerSlug === manufacturer),
        row => [row.lineSlug, row.line]
    )
}

function lineFacts(data: CompatData, view: CompatView, manufacturerSlug: string, lineSlug: string): string | undefined {
    const catalogLine = view.rows.find(
        row => row.manufacturerSlug === manufacturerSlug && row.lineSlug === lineSlug && row.catalogLine
    )?.catalogLine
    for (const manufacturer of data.catalog.manufacturers) {
        const line = manufacturer.lines.find(candidate => candidate.name === catalogLine)
        if (!line) continue
        const unverified = line.quirks.filter(quirk => quirk.unverified).length
        return escapeHtml(
            `${line.name} · ${line.protocolFamily} · ${line.models.length} catalog models` +
                (unverified ? ` · ${unverified} unverified quirks` : '') +
                (line.note ? ` · ${line.note}` : '')
        )
    }
    return undefined
}

export function tablePage(
    data: CompatData,
    view: CompatView,
    context: PageContext,
    route: { manufacturer?: string; line?: string },
    search: string
): PageResult {
    const filters = parseFilters(
        search,
        view.capabilities.map(capability => capability.id)
    )
    const manufacturers = manufacturersOf(view)
    if (route.manufacturer && !manufacturers.some(entry => entry.slug === route.manufacturer)) {
        return { status: 404, html: renderNotFound(context, `No cameras for manufacturer "${route.manufacturer}".`) }
    }
    const lines = route.manufacturer ? linesOf(view, route.manufacturer) : []
    if (route.line && !lines.some(entry => entry.slug === route.line)) {
        return { status: 404, html: renderNotFound(context, `No line "${route.line}" for ${route.manufacturer}.`) }
    }
    const effective = { ...filters, ...route }
    const rows = applyFilters(view.rows, effective)
    return {
        status: 200,
        html: renderTablePage(context, {
            view,
            rows,
            filters: effective,
            route,
            manufacturers,
            lines,
            ...(route.manufacturer &&
                route.line && { lineFacts: lineFacts(data, view, route.manufacturer, route.line) }),
        }),
    }
}

const CELL = (status: string, detail: string) => ({ status: status as CellStatus, detail })

export function cameraPage(data: CompatData, view: CompatView, context: PageContext, profileId: string): PageResult {
    const detail = data.cameraDetail(profileId)
    if (!detail) return { status: 404, html: renderNotFound(context, `No camera profile "${profileId}".`) }
    const profile = detail.indexed?.profile
    const viewRow = view.rows.find(row => row.profile === profileId)
    const sources = profile?.provenance.sources ?? []
    const catalogModel = detail.indexed?.catalogModel
    const facts: [string, string][] = [
        ['Profile', `<code>${escapeHtml(detail.indexed?.path ?? viewRow?.path ?? profileId)}</code>`],
        ['Fidelity', escapeHtml(profile?.provenance.fidelity ?? viewRow?.fidelity ?? 'unknown')],
        [
            'USB',
            escapeHtml(
                profile?.usb
                    ? `${profile.usb.vendorId} : ${profile.usb.productIds.join(', ')}`
                    : (viewRow?.usb.join(', ') ?? '') || 'none'
            ),
        ],
        ...((profile?.catalog ? [['Catalog line', escapeHtml(profile.catalog.line)]] : []) as [string, string][]),
        ...((profile?.firmware ? [['Firmware', escapeHtml(profile.firmware)]] : []) as [string, string][]),
        ...((catalogModel
            ? [
                  ['Catalog entry', citation([{ location: catalogModel.source }], 0).replace('[0] ', '')],
                  ['libgphoto2 flags', escapeHtml(catalogModel.gphotoFlags?.join(' ') || 'none')],
                  ['Catalog status', catalogModel.unverified ? '<span class="badge warn">unverified</span>' : 'cited'],
              ]
            : []) as [string, string][]),
        ...((profile?.deviceInfo
            ? [
                  [
                      'DeviceInfo',
                      escapeHtml(
                          `${profile.deviceInfo.manufacturer ?? ''} ${profile.deviceInfo.model ?? ''}`.trim() +
                              ` · ${profile.deviceInfo.operationsSupported?.length ?? 0} operations` +
                              (profile.deviceInfo.listsComplete ? ' (complete list)' : ' (incomplete list)')
                      ),
                  ],
              ]
            : []) as [string, string][]),
    ]
    const label = (fidelity: string, transport: string) =>
        `${fidelity === 'hardware' ? 'Hardware' : `Simulated (${fidelity})`} · ${transport === 'ptp-ip' ? 'PTP/IP' : 'USB'}`
    const html = renderCameraPage(context, {
        profileId,
        model: profile?.model ?? viewRow?.model ?? profileId,
        manufacturer: profile?.manufacturer ?? viewRow?.manufacturer ?? '',
        line: profile?.line ?? viewRow?.line ?? '',
        capabilities: view.capabilities,
        facts,
        results: detail.rows.map(row => ({
            key: `${row.fidelity}/${row.transport}/${profileId}`,
            label: label(row.fidelity, row.transport) + (row.host ? ` (${row.host})` : ''),
            source: row.source,
            at: row.at,
            cells: Object.fromEntries(
                Object.entries(row.results).map(([capability, result]) => [
                    capability,
                    CELL(result.status, result.detail),
                ])
            ),
        })),
        related: detail.related,
        quirks: (profile?.quirks ?? []).map(quirk => ({
            id: quirk.id,
            description: quirk.description,
            behaviour: quirk.behaviour.kind,
            unverified: !!quirk.unverified,
            citation: citation(sources, quirk.source),
        })),
        exchanges: (profile?.exchanges ?? []).slice(0, 80).map(exchange => ({
            operation: `${exchange.operation}${exchange.name ? ` ${exchange.name}` : ''}`,
            parameters: exchange.parameters ? `[${exchange.parameters.join(', ')}]` : '[any]',
            response: `${exchange.response.code}${exchange.response.data ? ` + ${exchange.response.data.length / 2} bytes` : ''}`,
            note: exchange.note ?? '',
            citation: citation(sources, exchange.source),
        })),
        sources,
        history: detail.history.slice(0, 30).map(entry => ({
            runId: entry.runId,
            source: entry.source,
            at: entry.at,
            label: label(entry.fidelity, entry.transport),
            cells: Object.fromEntries(
                Object.entries(entry.statuses).map(([capability, result]) => [
                    capability,
                    CELL(result.status, result.detail),
                ])
            ),
        })),
        ...(view.activeRun && { activeRun: view.activeRun }),
    })
    return { status: 200, html }
}

export function runsPage(data: CompatData, view: CompatView, context: PageContext): PageResult {
    const matrices = data.matrixFiles().flatMap(file => {
        const matrix = data.readMatrix(file.file)
        return matrix
            ? [{ id: file.id, label: file.label, generatedAt: matrix.generatedAt, rows: matrix.rows.length }]
            : []
    })
    return { status: 200, html: renderRunsPage(context, { view, matrices }) }
}

export function gapsPage(data: CompatData, context: PageContext): PageResult {
    return { status: 200, html: renderGapsPage(context, data.gapReport()) }
}

/** Resolves a path (without the base prefix) and query string to a page. */
export function routePage(data: CompatData, context: PageContext, pathname: string, search: string): PageResult {
    const runId = new URLSearchParams(search).get('run')
    const view = runId ? data.singleView(runId) : data.view()
    if (!view) return { status: 404, html: renderNotFound(context, `No run or result file "${runId}".`) }
    const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (segments.length === 0) return tablePage(data, view, context, {}, search)
    if (segments[0] === 'm' && segments.length <= 3 && segments[1]) {
        return tablePage(
            data,
            view,
            context,
            { manufacturer: segments[1], ...(segments[2] && { line: segments[2] }) },
            search
        )
    }
    if (segments[0] === 'camera' && segments.length === 2) return cameraPage(data, view, context, segments[1])
    if (segments[0] === 'runs' && segments.length === 1) return runsPage(data, view, context)
    if (segments[0] === 'gaps' && segments.length === 1) return gapsPage(data, context)
    return { status: 404, html: renderNotFound(context, `No page at /${segments.join('/')}.`) }
}
