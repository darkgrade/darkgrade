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
import { usbIdentities } from '@scripts/camera-profiles/profile-index'
import type { CompatData } from './compat-data'
import { applyFilters, parseFilters } from './compat-filters'
import {
    escapeHtml,
    renderCameraPage,
    renderGapsPage,
    renderNotFound,
    renderRunsPage,
    renderTablePage,
    type CameraDetailModel,
    type PageContext,
} from './compat-pages'
import { nameSlug, viewResult, type CompatView, type ViewRow } from './compat-view'

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

function resultCells(results: Record<string, { status: unknown; detail: unknown }>) {
    return Object.fromEntries(
        Object.entries(results).map(([capability, result]) => [capability, viewResult(result?.status, result?.detail)])
    )
}

function resultLabel(fidelity: string, transport: string): string {
    return `${fidelity === 'hardware' ? 'Hardware' : `Simulated (${fidelity})`} · ${transport === 'ptp-ip' ? 'PTP/IP' : 'USB'}`
}

/** Everything known about one profile as plain data; the camera page, the modal and the API share it. */
export function cameraDetailModel(
    data: CompatData,
    view: CompatView,
    profileId: string
): CameraDetailModel | undefined {
    const detail = data.cameraDetail(profileId)
    if (!detail) return undefined
    const profile = detail.indexed?.profile
    const viewRows = view.rows.filter(row => row.profile === profileId)
    const viewRow = viewRows[0]
    const catalogModel = detail.indexed?.catalogModel
    const manufacturer = profile?.manufacturer ?? viewRow?.manufacturer ?? 'Unknown'
    const line = profile?.line ?? viewRow?.line ?? 'Unknown'
    const identities = profile ? usbIdentities(profile) : (viewRow?.usb ?? [])
    const transports = [
        ...new Set([...detail.rows.map(row => row.transport), ...viewRows.map(row => row.transport)]),
    ].sort()
    const unverifiedQuirks = profile?.quirks.filter(quirk => quirk.unverified).length ?? viewRow?.unverifiedQuirks ?? 0
    const exchanges = profile?.exchanges ?? []
    return {
        profileId,
        model: profile?.model ?? viewRow?.model ?? profileId,
        manufacturer,
        manufacturerSlug: viewRow?.manufacturerSlug ?? nameSlug(manufacturer),
        line,
        lineSlug: viewRow?.lineSlug ?? nameSlug(line),
        fidelity: profile?.provenance.fidelity ?? viewRow?.fidelity ?? 'unknown',
        ...((viewRow?.scope ?? (catalogModel ? 'model' : undefined)) && {
            scope: viewRow?.scope ?? 'model',
        }),
        path: detail.indexed?.path ?? viewRow?.path ?? profileId,
        usb: {
            ...(profile?.usb && { vendorId: profile.usb.vendorId }),
            productIds: profile?.usb?.productIds ?? [],
            identities,
        },
        transports: transports.length ? transports : ['usb'],
        unverified: unverifiedQuirks > 0 || !!catalogModel?.unverified || !!viewRow?.unverified,
        unverifiedQuirks,
        ...(profile?.catalog && { catalogLine: profile.catalog.line }),
        ...(profile?.firmware && { firmware: profile.firmware }),
        ...(catalogModel && {
            catalogEntry: {
                source: catalogModel.source,
                gphotoFlags: catalogModel.gphotoFlags ?? [],
                unverified: !!catalogModel.unverified,
            },
        }),
        ...(profile?.deviceInfo && {
            deviceInfo: {
                ...(profile.deviceInfo.manufacturer && { manufacturer: profile.deviceInfo.manufacturer }),
                ...(profile.deviceInfo.model && { model: profile.deviceInfo.model }),
                operations: profile.deviceInfo.operationsSupported?.length ?? 0,
                complete: !!profile.deviceInfo.listsComplete,
            },
        }),
        capabilities: view.capabilities,
        results: detail.rows.map(row => ({
            key: row.key,
            fidelity: row.fidelity,
            transport: row.transport,
            ...(row.host && { host: row.host }),
            ...(row.firmware && { firmware: row.firmware }),
            label:
                resultLabel(row.fidelity, row.transport) +
                (row.firmware ? ` · firmware ${row.firmware}` : '') +
                (row.host ? ` (${row.host})` : ''),
            source: row.source,
            at: row.at,
            cells: Object.fromEntries(
                Object.entries(row.results).map(([capability, result]) => [
                    capability,
                    {
                        ...viewResult(result.status, result.detail),
                        evidence:
                            row.resultEvidence === undefined
                                ? {
                                      fidelity: row.fidelity,
                                      profile: profileId,
                                      generatedAt: row.at,
                                      ...(row.firmware && { firmware: row.firmware }),
                                      ...(row.host && { host: row.host }),
                                  }
                                : row.resultEvidence[capability],
                    },
                ])
            ),
        })),
        related: detail.related,
        quirks: (profile?.quirks ?? []).map(quirk => ({
            id: quirk.id,
            description: quirk.description,
            behaviour: quirk.behaviour.kind,
            unverified: !!quirk.unverified,
            ...(quirk.source !== undefined && { source: quirk.source }),
        })),
        exchanges: exchanges.slice(0, 80).map(exchange => ({
            operation: `${exchange.operation}${exchange.name ? ` ${exchange.name}` : ''}`,
            parameters: exchange.parameters ? `[${exchange.parameters.join(', ')}]` : '[any]',
            response: `${exchange.response.code}${exchange.response.data ? ` + ${exchange.response.data.length / 2} bytes` : ''}`,
            note: exchange.note ?? '',
            ...(exchange.source !== undefined && { source: exchange.source }),
        })),
        exchangeCount: exchanges.length,
        sources: profile?.provenance.sources ?? [],
        history: detail.history.slice(0, 30).map(entry => ({
            runId: entry.runId,
            source: entry.source,
            at: entry.at,
            label: resultLabel(entry.fidelity, entry.transport),
            cells: Object.fromEntries(
                Object.entries(entry.statuses).map(([capability, result]) => [
                    capability,
                    {
                        ...viewResult(result.status, result.detail),
                        evidence: { fidelity: entry.fidelity, profile: profileId, generatedAt: entry.at },
                    },
                ])
            ),
        })),
        ...(view.activeRun && { activeRun: view.activeRun }),
    }
}

export function cameraPage(data: CompatData, view: CompatView, context: PageContext, profileId: string): PageResult {
    const model = cameraDetailModel(data, view, profileId)
    if (!model) return { status: 404, html: renderNotFound(context, `No camera profile "${profileId}".`) }
    return { status: 200, html: renderCameraPage(context, model) }
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
    let segments: string[]
    try {
        segments = pathname.split('/').filter(Boolean).map(decodeURIComponent)
    } catch {
        return { status: 400, html: renderNotFound(context, 'That address is not valid.') }
    }
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
