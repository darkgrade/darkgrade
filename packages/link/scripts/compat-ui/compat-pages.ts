/**
 * HTML for the compatibility UI. Pure string rendering with no Node or DOM dependencies, so the
 * server, the static export and the browser (for live row updates and the camera modal) render
 * identically. Every value that came from a file is escaped; statuses, tiers and links are drawn as
 * icons whose tooltips and accessible names carry the words they replace.
 */
import type { CompatFilters } from './compat-filters'
import { FIDELITIES, KINDS, serializeFilters, TRANSPORTS } from './compat-filters'
import type { GapReport, LineGaps } from './compat-gaps'
import { nextStep } from './compat-gaps'
import {
    capabilityShortLabel,
    decorativeIcon,
    FIDELITY_LABELS,
    fidelityIcon,
    formatAge,
    icon,
    knownStatus,
    manufacturerCode,
    STATUS_LABELS,
    STATUS_MEANINGS,
    statusIcon,
    TRANSPORT_LABELS,
    transportIcon,
    unverifiedIcon,
} from './compat-icons'
import {
    CELL_STATUSES,
    nameSlug,
    rowProgress,
    type CellStatus,
    type CompatView,
    type RunSummary,
    type ViewCell,
    type ViewFidelity,
    type ViewRow,
} from './compat-view'

export interface PageContext {
    /** URL prefix ending in "/": "/" for the server, the hosting path for a static export. */
    base: string
    /** The local server can stream progress and start runs; a static export cannot. */
    live: boolean
}

export function escapeHtml(text: unknown): string {
    return String(text ?? '').replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

const attribute = escapeHtml

function formatTime(iso: string | undefined): string {
    if (!iso) return ''
    return escapeHtml(iso.slice(0, 16).replace('T', ' '))
}

function finite(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function percentOf(part: number, whole: number): number {
    return whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : 0
}

function segment(value: string): string {
    return encodeURIComponent(value)
}

export function cameraHref(context: PageContext, profile: string): string {
    return `${context.base}camera/${segment(profile)}`
}

export function manufacturerHref(context: PageContext, manufacturerSlug: string, lineSlug?: string): string {
    return `${context.base}m/${segment(manufacturerSlug)}${lineSlug ? `/${segment(lineSlug)}` : ''}`
}

function cellTitle(capability: { label: string }, status: CellStatus, cell: ViewCell | undefined): string {
    const detail = cell?.detail && cell.detail.length > 160 ? `${cell.detail.slice(0, 159)}…` : cell?.detail
    return `${capability.label}: ${STATUS_LABELS[status]}${detail ? ` — ${detail}` : ''}`
}

function evidenceDescription(cell: ViewCell | undefined): string {
    const evidence = cell?.evidence
    if (!evidence || typeof evidence !== 'object') return 'Evidence source unavailable'
    const conflicts = Array.isArray(evidence.conflicts) ? evidence.conflicts : []
    return [
        evidence.fidelity,
        evidence.profile,
        evidence.firmware ? `firmware ${evidence.firmware}` : 'firmware unknown',
        evidence.host,
        evidence.generatedAt,
        evidence.revision,
        ...conflicts.map(
            conflict => `conflict: ${conflict?.status} from ${conflict?.profile} at ${conflict?.generatedAt}`
        ),
    ]
        .filter(Boolean)
        .join(' · ')
}

export function renderCellEvidence(cell: ViewCell | undefined): string {
    if (!cell || cell.status === 'queued' || cell.status === 'running') return ''
    const evidence = cell.evidence
    if (!evidence || typeof evidence !== 'object') return icon('unknown', 'Evidence source unavailable', 'warn')
    const conflict =
        Array.isArray(evidence.conflicts) && evidence.conflicts.length
            ? `${icon('unknown', 'Conflicting evidence', 'warn')} `
            : ''
    return `${conflict}${fidelityIcon(evidence)} <span class="muted small">${escapeHtml(evidenceDescription(cell))}</span>`
}

export function renderCell(
    cell: ViewCell | undefined,
    capability: { id: string; label: string },
    rowFidelity?: ViewRow['fidelity']
): string {
    const status = knownStatus(cell?.status ?? 'no-data')
    const evidence = cell?.evidence
    const fallback = evidence && rowFidelity && evidence.fidelity !== rowFidelity ? ` ${fidelityIcon(evidence)}` : ''
    const unknown =
        cell && !evidence && rowFidelity && status !== 'queued' && status !== 'running'
            ? ` ${icon('unknown', 'Evidence source unavailable', 'warn')}`
            : ''
    return `<td class="c" data-capability="${attribute(capability.id)}" title="${attribute(`${cellTitle(capability, status, cell)} · ${evidenceDescription(cell)}`)}">${icon(status, STATUS_LABELS[status], `s-${status}`, '')}${fallback}${unknown}</td>`
}

function progressMeter(done: number, total: number, label: string, wide = false): string {
    const percent = percentOf(done, total)
    return `<span class="meter${wide ? ' wide' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="${attribute(label)}" title="${attribute(label)}"><span style="width:${percent}%"></span></span>`
}

export function renderRow(row: ViewRow, capabilities: { id: string; label: string }[], context: PageContext): string {
    const progress = rowProgress(row, capabilities.length)
    const progressCell =
        row.state === 'idle'
            ? ''
            : progressMeter(progress.done, progress.total, `${progress.done}/${progress.total} checks`)
    const state = ['idle', 'queued', 'running', 'done'].includes(row.state) ? row.state : 'idle'
    return [
        `<tr data-key="${attribute(row.key)}" data-profile="${attribute(row.profile)}" class="r-${state}">`,
        `<td class="model"><a class="open" href="${attribute(cameraHref(context, row.profile))}" title="${attribute(row.model)}">${escapeHtml(row.model)}</a></td>`,
        `<td class="maker"><a href="${attribute(manufacturerHref(context, row.manufacturerSlug))}" title="${attribute(row.manufacturer)}" aria-label="${attribute(row.manufacturer)}">${escapeHtml(manufacturerCode(row.manufacturerSlug))}</a></td>`,
        `<td class="line"><a href="${attribute(manufacturerHref(context, row.manufacturerSlug, row.lineSlug))}" title="${attribute(row.line)}">${escapeHtml(row.line)}</a></td>`,
        `<td class="ic">${fidelityIcon(row)}</td>`,
        `<td class="ic">${transportIcon(row.transport)}</td>`,
        `<td class="ic">${unverifiedIcon(row)}</td>`,
        `<td class="progress">${progressCell}</td>`,
        ...capabilities.map(capability => renderCell(row.cells?.[capability.id], capability, row.fidelity)),
        `<td class="time" title="${attribute(row.lastRun ?? 'never run')}" data-at="${attribute(row.lastRun ?? '')}">${escapeHtml(formatAge(row.lastRun))}</td>`,
        '</tr>',
    ].join('')
}

function statusTotals(rows: ViewRow[]): Record<CellStatus, number> {
    const totals = Object.fromEntries(CELL_STATUSES.map(status => [status, 0])) as Record<CellStatus, number>
    for (const row of rows) for (const cell of Object.values(row.cells ?? {})) totals[knownStatus(cell?.status)] += 1
    return totals
}

function iconCount(status: CellStatus, count: number): string {
    return `<span class="count s-${status}" title="${count} ${STATUS_LABELS[status]}">${icon(status, STATUS_LABELS[status], '', '')}${count}</span>`
}

export function renderCounts(rows: ViewRow[], total: number): string {
    const totals = statusTotals(rows)
    const parts = CELL_STATUSES.filter(status => totals[status]).map(status => iconCount(status, totals[status]))
    const shown =
        rows.length === total ? `<strong>${total}</strong> rows` : `<strong>${rows.length}</strong>/${total} rows`
    return `<span class="shown">${shown}</span>${parts.join('')}`
}

export function renderProgress(run: RunSummary | undefined, context: PageContext): string {
    if (!run) return ''
    const counts = run.counts ?? {}
    const finishedCells = finite(run.finishedCells)
    const cells = finite(run.cells)
    const percent = percentOf(finishedCells, cells)
    const current = run.current
        ? `<span class="now" title="checking ${attribute(run.current.capability)} on ${attribute(run.current.key)}">${decorativeIcon('running')}<code>${escapeHtml(String(run.current.key).split('/').at(-1))}</code> ${escapeHtml(run.current.capability)}</span>`
        : ''
    const label = run.source === 'hardware' ? 'Hardware run' : 'Simulation run'
    const tally = (['pass', 'fail', 'unsupported', 'no-data', 'unknown'] as const)
        .filter(status => finite(counts[status]) > 0 || status === 'pass')
        .map(status => iconCount(status, finite(counts[status])))
        .join('')
    return [
        `<div class="run-progress" data-run="${attribute(run.runId)}">`,
        icon(run.source === 'hardware' ? 'hardware' : 'play', label, 'run-kind'),
        progressMeter(finishedCells, cells, `${finishedCells}/${cells} checks (${percent}%)`, true),
        `<span class="numbers"><strong>${percent}%</strong> <span class="muted" title="rows finished">${finite(run.finishedRows)}/${finite(run.rows)} rows</span></span>`,
        `<span class="tally">${tally}</span>`,
        current,
        run.filter ? `<code class="filter" title="filter">${escapeHtml(run.filter)}</code>` : '',
        `<a class="runs-link" href="${context.base}runs">runs</a>`,
        '</div>',
    ].join('')
}

function layout(
    context: PageContext,
    options: {
        title: string
        description: string
        page: string
        body: string
        breadcrumbs?: [string, string?][]
        modal?: boolean
    }
): string {
    const crumbs = options.breadcrumbs?.length
        ? `<nav class="crumbs" aria-label="Breadcrumbs">${options.breadcrumbs
              .map(([label, href]) =>
                  href ? `<a href="${attribute(href)}">${escapeHtml(label)}</a>` : escapeHtml(label)
              )
              .join(' / ')}</nav>`
        : ''
    const modal = options.modal
        ? `<dialog id="camera-modal" class="modal" aria-labelledby="camera-title">
<div class="modal-bar"><a id="modal-page" class="icon-link" href="#">${decorativeIcon('open')}Open page</a><button type="button" class="icon-button" data-close aria-label="Close">${decorativeIcon('close')}</button></div>
<div id="modal-body" class="modal-body" tabindex="-1"></div>
</dialog>`
        : ''
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
<meta name="description" content="${attribute(options.description)}">
<link rel="stylesheet" href="${context.base}assets/compat-ui.css">
<script type="module" src="${context.base}assets/client.js"></script>
</head>
<body data-base="${attribute(context.base)}" data-live="${context.live}" data-page="${attribute(options.page)}">
<header class="top">
<a class="brand" href="${context.base}">darkgrade <span class="muted">compatibility</span></a>
<nav><a href="${context.base}">Cameras</a><a href="${context.base}gaps">Gaps</a><a href="${context.base}runs">Runs</a>${context.live ? `<a href="${context.base}api/v1">API</a>` : ''}</nav>
<span id="live-status" class="live-status${context.live ? ' is-live' : ''}" role="status">${context.live ? 'local' : 'static'}</span>
</header>
<main>
${crumbs}
${options.body}
</main>
${modal}
</body>
</html>
`
}

export interface TablePageInput {
    view: CompatView
    rows: ViewRow[]
    filters: CompatFilters
    route: { manufacturer?: string; line?: string }
    manufacturers: { slug: string; name: string; rows: number }[]
    lines: { slug: string; name: string; rows: number }[]
    lineFacts?: string
}

function sortHeader(
    filters: CompatFilters,
    id: string,
    content: { label: string; title?: string; html?: string },
    routePath: string
): string {
    const active = filters.sort === id
    const order = active && filters.order === 'asc' ? 'desc' : 'asc'
    const query = serializeFilters({ ...filters, sort: id, order }, ['manufacturer', 'line'])
    const arrow = active ? (filters.order === 'desc' ? ' ↓' : ' ↑') : ''
    return `<a class="sort" data-sort="${attribute(id)}" data-label="${attribute(content.label)}" href="${attribute(`${routePath}?${query}`)}" title="${attribute(`Sort by ${content.title ?? content.label}`)}">${content.html ?? escapeHtml(content.label)}<span class="arrow">${arrow}</span></a>`
}

function option(value: string, label: string, selected: boolean): string {
    return `<option value="${attribute(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
}

export function routePath(context: PageContext, route: { manufacturer?: string; line?: string }): string {
    return route.manufacturer ? manufacturerHref(context, route.manufacturer, route.line) : context.base
}

function chip(name: string, value: string, checked: boolean, iconName: string, label: string): string {
    return `<label class="chip" title="${attribute(label)}"><input type="checkbox" name="${name}" value="${attribute(value)}"${checked ? ' checked' : ''}>${icon(iconName, label, '', '')}</label>`
}

function filterBar(context: PageContext, input: TablePageInput): string {
    const { filters, route } = input
    const tiers = FIDELITIES.map(value =>
        chip('fidelity', value, filters.fidelity.includes(value), value, FIDELITY_LABELS[value])
    ).join('')
    const links = TRANSPORTS.map(value =>
        chip('transport', value, filters.transport.includes(value), value, `Link: ${TRANSPORT_LABELS[value]}`)
    ).join('')
    const statusFilters = Object.keys(filters.status).length
    return `<form id="filters" class="filters" method="get" action="${attribute(routePath(context, route))}">
<input type="search" name="q" placeholder="Search model, profile, VID:PID" aria-label="Search" value="${attribute(filters.q ?? '')}">
<select name="manufacturer" data-route="manufacturer" aria-label="Manufacturer">${option('', 'All makers', !route.manufacturer)}${input.manufacturers
        .map(entry => option(entry.slug, `${entry.name} (${entry.rows})`, entry.slug === route.manufacturer))
        .join('')}</select>
<select name="line" data-route="line" aria-label="Line"${route.manufacturer ? '' : ' disabled'}>${option('', 'All lines', !route.line)}${input.lines
        .map(entry => option(entry.slug, `${entry.name} (${entry.rows})`, entry.slug === route.line))
        .join('')}</select>
<span class="chips-group" role="group" aria-label="Tier">${tiers}</span>
<span class="chips-group" role="group" aria-label="Link">${links}</span>
<span class="chips-group">${chip('unverified', 'yes', filters.unverified === 'yes', 'unverified', 'Only rows with unverified quirks or catalog entries')}</span>
<select name="kind" aria-label="Kind">${option('', 'All kinds', !filters.kind.length)}${KINDS.map(value =>
        option(
            value,
            value === 'profile' ? 'Captured / hardware' : `${value === 'model' ? 'Model' : 'Line'} mocks`,
            filters.kind.length === 1 && filters.kind[0] === value
        )
    ).join('')}</select>
<button type="button" id="toggle-status-filters" class="icon-button${statusFilters ? ' active' : ''}" aria-pressed="${statusFilters ? 'true' : 'false'}" title="Filter by result per capability">${decorativeIcon('filter')}<span class="sr">Result filters</span>${statusFilters ? `<span class="badge-count">${statusFilters}</span>` : ''}</button>
${filters.sort ? `<input type="hidden" name="sort" value="${attribute(filters.sort)}"><input type="hidden" name="order" value="${filters.order === 'desc' ? 'desc' : 'asc'}">` : ''}
${filters.run ? `<input type="hidden" name="run" value="${attribute(filters.run)}">` : ''}
${filters.profile.length ? `<input type="hidden" name="profile" value="${attribute(filters.profile.join(','))}">` : ''}
<noscript><button type="submit">Apply</button></noscript>
<a class="icon-link reset" href="${attribute(routePath(context, route))}" title="Clear filters">${decorativeIcon('reset')}Reset</a>
${context.live ? `<button type="button" id="run-view" class="icon-button primary" title="Run the simulation suite for the rows this view selects">${decorativeIcon('play')}Run view</button>` : ''}
</form>`
}

function legendEntry(iconHtml: string, label: string, meaning: string): string {
    return `<li>${iconHtml}<b>${escapeHtml(label)}</b><span>${escapeHtml(meaning)}</span></li>`
}

export function renderLegend(): string {
    const statuses = CELL_STATUSES.map(status =>
        legendEntry(statusIcon(status), STATUS_LABELS[status], STATUS_MEANINGS[status])
    )
    const tiers = [
        legendEntry(fidelityIcon({ fidelity: 'hardware' }), 'hardware', 'ran on a physical camera'),
        legendEntry(fidelityIcon({ fidelity: 'captured' }), 'captured', 'replays traffic recorded from a real camera'),
        legendEntry(
            fidelityIcon({ fidelity: 'documented', scope: 'model' }),
            'documented model',
            'per-model mock from libgphoto2 and vendor docs; not hardware-verified'
        ),
        legendEntry(
            fidelityIcon({ fidelity: 'documented', scope: 'line' }),
            'documented line',
            'one mock for a whole camera line'
        ),
    ]
    const other = [
        legendEntry(transportIcon('usb'), 'USB', 'exercised over USB'),
        legendEntry(transportIcon('ptp-ip'), 'PTP/IP', 'the same profile served over the network'),
        legendEntry(
            unverifiedIcon({ unverified: true, unverifiedQuirks: 0 }),
            'unverified',
            'a quirk or catalog entry its source marks unconfirmed'
        ),
        legendEntry(progressMeter(4, 10, '4/10 checks'), 'progress', 'checks finished for a row in the current run'),
    ]
    return `<details class="legend" id="legend"><summary title="What the icons mean">${decorativeIcon('help')}<span>Legend</span></summary>
<div class="legend-panel">
<div><h3>Result</h3><ul>${statuses.join('')}</ul></div>
<div><h3>Tier</h3><ul>${tiers.join('')}</ul></div>
<div><h3>Row</h3><ul>${other.join('')}</ul><p class="muted small">Makers are three-letter codes and the last-run column is the age of the newest result; hover for full names and times. Click a row for its details.</p></div>
</div>
</details>`
}

export function renderTablePage(context: PageContext, input: TablePageInput): string {
    const { view, filters, rows, route } = input
    const path = routePath(context, route)
    const manufacturer = input.manufacturers.find(entry => entry.slug === route.manufacturer)
    const line = input.lines.find(entry => entry.slug === route.line)
    const title = line
        ? `${manufacturer?.name ?? route.manufacturer} ${line.name} compatibility`
        : manufacturer
          ? `${manufacturer.name} camera compatibility`
          : 'Camera compatibility'
    const capabilities = view.capabilities
    const statusFilters = capabilities
        .map(
            capability =>
                `<th><select form="filters" name="${attribute(capability.id)}" aria-label="${attribute(capability.label)} result">${option('', 'any', !filters.status[capability.id])}${CELL_STATUSES.map(
                    status =>
                        option(
                            status,
                            STATUS_LABELS[status],
                            filters.status[capability.id]?.length === 1 && filters.status[capability.id][0] === status
                        )
                ).join('')}</select></th>`
        )
        .join('')
    const header = [
        `<th class="model">${sortHeader(filters, 'model', { label: 'Model' }, path)}</th>`,
        `<th class="maker">${sortHeader(filters, 'manufacturer', { label: 'Make', title: 'manufacturer' }, path)}</th>`,
        `<th class="line">${sortHeader(filters, 'line', { label: 'Line' }, path)}</th>`,
        `<th class="ic">${sortHeader(filters, 'fidelity', { label: 'Tier', title: 'tier (fidelity)' }, path)}</th>`,
        `<th class="ic">${sortHeader(filters, 'transport', { label: 'Link' }, path)}</th>`,
        `<th class="ic">${sortHeader(filters, 'unverified', { label: 'Unverified', html: decorativeIcon('unverified') + '<span class="sr">Unverified</span>' }, path)}</th>`,
        '<th class="progress" aria-label="Run progress"></th>',
        ...capabilities.map(
            capability =>
                `<th class="cap">${sortHeader(filters, capability.id, { label: capabilityShortLabel(capability), title: capability.label }, path)}</th>`
        ),
        `<th class="time">${sortHeader(filters, 'last-run', { label: 'Age', title: 'last run' }, path)}</th>`,
    ].join('')
    const lineChips =
        route.manufacturer && !route.line
            ? `<p class="line-chips">${input.lines
                  .map(
                      entry =>
                          `<a href="${attribute(manufacturerHref(context, route.manufacturer!, entry.slug))}">${escapeHtml(entry.name)} <span class="muted">${entry.rows}</span></a>`
                  )
                  .join('')}</p>`
            : ''
    const tableClasses = [
        'matrix',
        view.activeRun ? 'has-run' : '',
        Object.keys(filters.status).length ? 'show-status-filters' : '',
    ]
        .filter(Boolean)
        .join(' ')
    const body = `
<h1>${escapeHtml(title)}</h1>
${input.lineFacts ? `<p class="muted">${input.lineFacts}</p>` : ''}
${lineChips}
${filterBar(context, input)}
<div id="progress">${renderProgress(view.activeRun, context)}</div>
<div class="summary-bar"><p id="counts" class="counts">${renderCounts(rows, view.rows.length)}</p>${renderLegend()}</div>
<div class="table-wrap">
<table id="matrix" class="${tableClasses}">
<thead>
<tr>${header}</tr>
<tr class="status-filters"><th colspan="7"></th>${statusFilters}<th></th></tr>
</thead>
<tbody id="rows">
${rows.map(row => renderRow(row, capabilities, context)).join('\n')}
</tbody>
</table>
</div>`
    const breadcrumbs: [string, string?][] = route.manufacturer
        ? [
              ['All', context.base],
              [
                  manufacturer?.name ?? route.manufacturer,
                  route.line ? manufacturerHref(context, route.manufacturer) : undefined,
              ],
              ...(route.line ? ([[line?.name ?? route.line]] as [string][]) : []),
          ]
        : []
    return layout(context, {
        title,
        description: `${rows.length} camera profiles: darkgrade compatibility per capability (connect, DeviceInfo, properties, capture, live view, events).`,
        page: 'table',
        body,
        breadcrumbs,
        modal: true,
    })
}

export interface CameraResultSet {
    /** The view row key ("<fidelity>/<transport>/<profile>"), so live updates find the cells. */
    key: string
    fidelity: ViewFidelity
    transport: string
    host?: string
    label: string
    source: string
    at: string
    cells: Record<string, ViewCell>
    firmware?: string
}

/** Everything known about one camera profile, as plain data (the API serves it as JSON). */
export interface CameraDetailModel {
    profileId: string
    model: string
    manufacturer: string
    manufacturerSlug: string
    line: string
    lineSlug: string
    fidelity: ViewFidelity
    scope?: 'line' | 'model'
    path: string
    usb: { vendorId?: string; productIds: string[]; identities: string[] }
    transports: string[]
    unverified: boolean
    unverifiedQuirks: number
    catalogLine?: string
    firmware?: string
    catalogEntry?: { source: string; gphotoFlags: string[]; unverified: boolean }
    deviceInfo?: { manufacturer?: string; model?: string; operations: number; complete: boolean }
    capabilities: { id: string; label: string }[]
    results: CameraResultSet[]
    related: { profile: string; model: string; fidelity: string; path: string }[]
    quirks: { id: string; description: string; behaviour: string; unverified: boolean; source?: number }[]
    exchanges: { operation: string; parameters: string; response: string; note: string; source?: number }[]
    /** All recorded exchanges; `exchanges` holds the first 80. */
    exchangeCount: number
    sources: { location: string; excerpt?: string }[]
    history: {
        runId: string
        source: string
        at: string
        label: string
        cells: Record<string, ViewCell>
    }[]
    activeRun?: RunSummary
}

function linkify(location: string): string {
    return /^https?:\/\//.test(location)
        ? `<a href="${attribute(location)}" rel="noreferrer">${escapeHtml(location)}</a>`
        : `<code>${escapeHtml(location)}</code>`
}

export function citation(sources: { location: string; excerpt?: string }[], index: number | undefined): string {
    const source = index === undefined ? undefined : sources[index]
    if (!source) return ''
    return `[${index}] ${linkify(source.location)}`
}

/** One result cell of the camera detail, also used to apply live updates in place. */
export function renderDetailCell(
    key: string,
    capability: { id: string; label: string },
    cell: ViewCell | undefined
): string {
    const status = knownStatus(cell?.status ?? 'no-data')
    return `<td class="detail s-${status}" data-key="${attribute(key)}" data-capability="${attribute(capability.id)}">${detailCellContent(cell)}</td>`
}

export function detailCellContent(cell: ViewCell | undefined): string {
    const status = knownStatus(cell?.status ?? 'no-data')
    return `<span class="result">${icon(status, STATUS_LABELS[status], `s-${status}`, '')}<span class="word">${STATUS_LABELS[status]}</span></span><div class="why">${escapeHtml(cell?.detail ?? '')}</div><div class="cell-evidence">${renderCellEvidence(cell)}</div>`
}

/** Shared with existing consumers; the modal and full page use the same renderer. */
export const renderDetailCellContents = detailCellContent

function detailFacts(model: CameraDetailModel): [string, string][] {
    const facts: [string, string][] = [
        ['Profile', `<code>${escapeHtml(model.path)}</code>`],
        ['Tier', `${fidelityIcon(model)} ${escapeHtml(model.fidelity)}${model.scope ? ` (${model.scope} mock)` : ''}`],
        [
            'USB',
            model.usb.identities.length
                ? model.usb.identities.map(identity => `<code>${escapeHtml(identity)}</code>`).join(' ')
                : '<span class="muted">none</span>',
        ],
        [
            'Links',
            model.transports
                .map(transport => `${transportIcon(transport)} ${escapeHtml(TRANSPORT_LABELS[transport] ?? transport)}`)
                .join(' · '),
        ],
    ]
    if (model.catalogLine) facts.push(['Catalog line', escapeHtml(model.catalogLine)])
    if (model.firmware) facts.push(['Firmware', escapeHtml(model.firmware)])
    if (model.catalogEntry) {
        facts.push(['Catalog entry', linkify(model.catalogEntry.source)])
        facts.push(['libgphoto2 flags', escapeHtml(model.catalogEntry.gphotoFlags.join(' ') || 'none')])
        facts.push([
            'Catalog status',
            model.catalogEntry.unverified ? `${icon('unverified', 'unverified', 'warn')} unverified` : 'cited',
        ])
    }
    if (model.deviceInfo) {
        const name = `${model.deviceInfo.manufacturer ?? ''} ${model.deviceInfo.model ?? ''}`.trim()
        facts.push([
            'DeviceInfo',
            escapeHtml(
                `${name ? `${name} · ` : ''}${model.deviceInfo.operations} operations (${model.deviceInfo.complete ? 'complete' : 'incomplete'} list)`
            ),
        ])
    }
    return facts
}

function resultHeader(result: CameraResultSet): string {
    return `<th scope="col"><span class="set">${fidelityIcon({ fidelity: result.fidelity })}${transportIcon(result.transport)}<span>${escapeHtml(result.label)}</span></span><div class="muted small">${escapeHtml(result.source)} · <span title="${attribute(result.at)}">${formatTime(result.at)}</span></div></th>`
}

/**
 * The camera detail: identity, every result per tier and link, run history, quirks with citations,
 * recorded exchanges and sources. The camera page and the table's modal both show exactly this.
 */
export function renderCameraDetail(context: PageContext, model: CameraDetailModel, headingLevel: 1 | 2 = 1): string {
    const heading = `h${headingLevel}`
    const section = `h${headingLevel + 1}`
    const resultRows = model.capabilities.map(
        capability =>
            `<tr><th scope="row" title="${attribute(capability.id)}">${escapeHtml(capability.label)}</th>${model.results
                .map(result => renderDetailCell(result.key, capability, result.cells[capability.id]))
                .join('')}</tr>`
    )
    const results = model.results.length
        ? `<div class="table-wrap"><table class="matrix detail-table"><thead><tr><th scope="col">Capability</th>${model.results.map(resultHeader).join('')}</tr></thead><tbody>${resultRows.join('')}</tbody></table></div>`
        : '<p class="muted">No results yet for this profile.</p>'
    const history = model.history.length
        ? `<div class="table-wrap"><table class="matrix compact"><thead><tr><th>Run</th><th>When</th><th>Tier · link</th>${model.capabilities.map(capability => `<th class="cap" title="${attribute(capability.label)}">${escapeHtml(capabilityShortLabel(capability))}</th>`).join('')}</tr></thead><tbody>${model.history
              .map(
                  entry =>
                      `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(entry.runId)}&profile=${encodeURIComponent(model.profileId)}`)}"><code>${escapeHtml(entry.runId)}</code></a></td><td class="time" title="${attribute(entry.at)}">${escapeHtml(formatAge(entry.at))}</td><td>${escapeHtml(entry.label)}</td>${model.capabilities
                          .map(capability => renderCell(entry.cells[capability.id], capability))
                          .join('')}</tr>`
              )
              .join('')}</tbody></table></div>`
        : '<p class="muted">No run logs mention this profile yet. Runs from <code>test:simulation</code>, <code>compat:hardware</code> or Run view appear here.</p>'
    const quirks = model.quirks.length
        ? `<ul class="quirks">${model.quirks
              .map(
                  quirk =>
                      `<li><div><code>${escapeHtml(quirk.id)}</code>${quirk.unverified ? ` ${icon('unverified', 'unverified quirk', 'warn')}` : ''} <span class="muted small">simulated as <code>${escapeHtml(quirk.behaviour)}</code></span></div><div>${escapeHtml(quirk.description)}</div><div class="small muted">${citation(model.sources, quirk.source)}</div></li>`
              )
              .join('')}</ul>`
        : '<p class="muted">None recorded.</p>'
    const exchanges = model.exchanges.length
        ? `<details><summary>${model.exchangeCount} recorded exchange${model.exchangeCount === 1 ? '' : 's'}${model.exchangeCount > model.exchanges.length ? ` (first ${model.exchanges.length})` : ''}</summary><div class="table-wrap"><table class="list"><thead><tr><th>Request</th><th>Response</th><th>Note</th><th>Source</th></tr></thead><tbody>${model.exchanges.map(exchange => `<tr><td><code>${escapeHtml(exchange.operation)} ${escapeHtml(exchange.parameters)}</code></td><td><code>${escapeHtml(exchange.response)}</code></td><td>${escapeHtml(exchange.note)}</td><td class="small">${citation(model.sources, exchange.source)}</td></tr>`).join('')}</tbody></table></div></details>`
        : '<p class="muted">None recorded.</p>'
    const sources = model.sources.length
        ? `<details><summary>${model.sources.length} source${model.sources.length === 1 ? '' : 's'}</summary><ol start="0" class="sources">${model.sources.map(source => `<li>${linkify(source.location)}${source.excerpt ? `<blockquote>${escapeHtml(source.excerpt)}</blockquote>` : ''}</li>`).join('')}</ol></details>`
        : '<p class="muted">None recorded.</p>'
    const related = model.related.length
        ? `<${section}>Same USB identity</${section}><ul class="related">${model.related.map(entry => `<li><a class="open" data-profile="${attribute(entry.profile)}" href="${attribute(cameraHref(context, entry.profile))}">${escapeHtml(entry.model)}</a> ${fidelityIcon({ fidelity: entry.fidelity })} <code class="muted">${escapeHtml(entry.path)}</code></li>`).join('')}</ul>`
        : ''
    return `<article id="camera-detail" class="camera" data-profile="${attribute(model.profileId)}">
<header class="camera-head">
<${heading} id="camera-title">${escapeHtml(model.model)}</${heading}>
<p class="sub"><a href="${attribute(manufacturerHref(context, model.manufacturerSlug))}">${escapeHtml(model.manufacturer)}</a> · <a href="${attribute(manufacturerHref(context, model.manufacturerSlug, model.lineSlug))}">${escapeHtml(model.line)}</a> · <code>${escapeHtml(model.profileId)}</code> <span class="tags">${fidelityIcon(model)}${model.transports.map(transportIcon).join('')}${unverifiedIcon(model)}</span></p>
</header>
<div class="camera-progress">${renderProgress(model.activeRun, context)}</div>
<dl class="facts">${detailFacts(model)
        .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`)
        .join('')}</dl>
<${section}>Results</${section}>
${results}
<${section}>Run history</${section}>
${history}
<${section}>Quirks</${section}>
${quirks}
<${section}>Recorded exchanges</${section}>
${exchanges}
<${section}>Sources</${section}>
${sources}
${related}
</article>`
}

export function renderCameraPage(context: PageContext, model: CameraDetailModel): string {
    return layout(context, {
        title: `${model.model} · darkgrade compatibility`,
        description: `darkgrade compatibility results, USB identity, quirks and provenance for ${model.manufacturer} ${model.model}.`,
        page: 'camera',
        body: renderCameraDetail(context, model, 1),
        breadcrumbs: [
            ['All', context.base],
            [model.manufacturer, manufacturerHref(context, model.manufacturerSlug)],
            [model.line, manufacturerHref(context, model.manufacturerSlug, model.lineSlug)],
            [model.model],
        ],
    })
}

function runTally(run: RunSummary): string {
    const counts = run.counts ?? {}
    return (['pass', 'fail', 'unsupported', 'no-data', 'unknown'] as const)
        .filter(status => finite(counts[status]) > 0)
        .map(status => iconCount(status, finite(counts[status])))
        .join('')
}

export function renderRunsPage(
    context: PageContext,
    input: { view: CompatView; matrices: { id: string; label: string; generatedAt: string; rows: number }[] }
): string {
    const runRows = input.view.runs.map(run => {
        const outcome = run.outcome ?? (input.view.activeRun?.runId === run.runId ? 'running' : '')
        return `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(run.runId)}`)}"><code>${escapeHtml(run.runId)}</code></a></td><td>${icon(run.source === 'hardware' ? 'hardware' : 'play', run.source === 'hardware' ? 'hardware run' : 'simulation run')}</td><td class="time" title="${attribute(run.startedAt)}">${formatTime(run.startedAt)}</td><td>${escapeHtml(outcome)}</td><td>${progressMeter(finite(run.finishedRows), finite(run.rows), `${finite(run.finishedRows)}/${finite(run.rows)} rows`)} <span class="muted small">${finite(run.finishedRows)}/${finite(run.rows)}</span></td><td class="tally">${runTally(run)}</td><td>${run.filter ? `<code>${escapeHtml(run.filter)}</code>` : '<span class="muted">all</span>'}</td></tr>`
    })
    const matrixRows = input.matrices.map(
        matrix =>
            `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(matrix.id)}`)}">${escapeHtml(matrix.label)}</a></td><td class="time">${formatTime(matrix.generatedAt)}</td><td>${finite(matrix.rows)}</td></tr>`
    )
    const controls = context.live
        ? `<h2>Start or load</h2>
<form id="run-form" class="filters"><input name="filter" aria-label="Run filter" placeholder="Filter, e.g. manufacturer=sony&amp;transport=ptp-ip (empty = everything)" size="60"><button type="submit" class="icon-button primary">${decorativeIcon('play')}Run simulation</button><button type="button" id="cancel-run" class="icon-button" title="Stop the run this server started">${decorativeIcon('close')}Cancel run</button></form>
<form id="import-form" class="filters"><input type="file" name="file" accept=".json,.jsonl" aria-label="Results file"><button type="submit" class="icon-button">Load results file</button></form>
<p class="muted">Loads a run log (<code>*.jsonl</code>) or a support matrix (<code>*.json</code>) from a past or remote run. For hardware results that should feed the merged matrix, use <code>bun run compat:ingest -- --results &lt;file&gt;</code> or <code>POST /api/v1/ingest</code>.</p>`
        : ''
    const body = `<h1>Runs and result files</h1>
<div id="progress">${renderProgress(input.view.activeRun, context)}</div>
${controls}
<h2>Run logs</h2>
${runRows.length ? `<div class="table-wrap"><table class="list"><thead><tr><th>Run</th><th>Source</th><th>Started</th><th>Outcome</th><th>Rows</th><th>Checks</th><th>Filter</th></tr></thead><tbody>${runRows.join('')}</tbody></table></div>` : '<p class="muted">No run logs yet. Run <code>bun run test:simulation</code> or <code>bun run compat:hardware</code>.</p>'}
<h2>Completed matrices</h2>
${matrixRows.length ? `<table class="list"><thead><tr><th>Matrix</th><th>Generated</th><th>Rows</th></tr></thead><tbody>${matrixRows.join('')}</tbody></table>` : '<p class="muted">None yet.</p>'}`
    return layout(context, {
        title: 'Runs · darkgrade compatibility',
        description: 'Compatibility run logs and result files.',
        page: 'runs',
        body,
        breadcrumbs: [['All', context.base], ['Runs']],
    })
}

function gapRow(context: PageContext, line: LineGaps): string {
    const href = manufacturerHref(context, nameSlug(line.manufacturer.replace(/ \(other\)$/, '')), nameSlug(line.line))
    const evidence =
        [...line.capturedProfiles, ...line.hardwareProfiles.map(profile => `${profile} (hw)`)]
            .map(
                profile =>
                    `<a href="${attribute(cameraHref(context, profile.replace(' (hw)', '')))}">${escapeHtml(profile)}</a>`
            )
            .join(', ') || '-'
    const unverified =
        [line.unverifiedModels.length ? `${line.unverifiedModels.length} models` : '', ...line.unverifiedQuirks]
            .filter(Boolean)
            .map(escapeHtml)
            .join(', ') || '-'
    return `<tr><td>${escapeHtml(line.manufacturer)}</td><td><a href="${attribute(href)}">${escapeHtml(line.line)}</a></td><td>${finite(line.models)}</td><td>${finite(line.mockedModels)}${line.documentedMock ? '' : ` ${icon('unverified', 'no line mock', 'warn')}`}</td><td>${evidence}</td><td>${progressMeter(finite(line.noDataCells), finite(line.cells), `${finite(line.noDataCells)}/${finite(line.cells)} cells without data`)} <span class="small muted">${finite(line.noDataCells)}/${finite(line.cells)}</span></td><td>${unverified}</td><td class="small">${escapeHtml(line.ptpIp ?? '-')}</td><td class="small">${escapeHtml(nextStep(line))}</td></tr>`
}

export function renderGapsPage(context: PageContext, report: GapReport): string {
    const lines = report.manufacturers.flatMap(manufacturer => manufacturer.lines)
    const library = lines.filter(
        line =>
            line.undefinedVendorOperations.length || line.inexpressibleRequests.length || line.undefinedEvents.length
    )
    const { totals } = report
    const body = `<h1>Compatibility gaps</h1>
<p>${totals.undefinedVendorOperations} undefined vendor operations · ${totals.inexpressibleRequests} inexpressible recorded requests · ${totals.noDataCells}/${totals.cells} no-data cells · ${totals.linesWithoutCapture}/${lines.length} lines without captured or hardware evidence · ${totals.linesWithoutMock} lines without a mock · ${totals.unverifiedModels} unverified models · ${totals.unverifiedQuirks} unverified quirks · ${totals.skippedModels} models not mocked.</p>
<p class="muted small">The same report as JSON, grouped with next actions: <code>GET /api/v1/gaps</code>, or the <code>list_gaps</code> tool of <code>bun run compat:mcp</code>.</p>
<h2>Test Bench workflow qualification</h2>
<ul>${report.workflowLimitations.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
<h2>darkgrade library gaps</h2>
<p>Vendor definition registries (presence is not workflow support): ${report.manufacturers.map(manufacturer => `${escapeHtml(manufacturer.name)} ${manufacturer.vendorDefinitions ? 'defined' : '<b>missing</b>'}`).join(' · ')}.</p>
<div class="table-wrap"><table class="list"><thead><tr><th>Manufacturer</th><th>Line</th><th>Undefined vendor operations</th><th>Inexpressible recorded requests</th><th>Undefined events</th></tr></thead><tbody>${library
        .map(
            line =>
                `<tr><td>${escapeHtml(line.manufacturer)}</td><td>${escapeHtml(line.line)}</td><td><code>${escapeHtml(line.undefinedVendorOperations.join(' ') || '-')}</code></td><td><code>${escapeHtml(line.inexpressibleRequests.join(', ') || '-')}</code></td><td><code>${escapeHtml(line.undefinedEvents.join(' ') || '-')}</code></td></tr>`
        )
        .join('')}</tbody></table></div>
<h2>Data gaps</h2>
<div class="table-wrap"><table class="list"><thead><tr><th>Manufacturer</th><th>Line</th><th>Models</th><th>Mocked</th><th>Captured / hardware</th><th>No data</th><th>Unverified</th><th>PTP/IP</th><th>Next step</th></tr></thead><tbody>${lines.map(line => gapRow(context, line)).join('')}</tbody></table></div>
<h2>Catalog notes</h2>
${report.libraryNotes.map(note => `<details><summary>${escapeHtml(note.key)} (${note.items.length})</summary><ul>${note.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>`).join('')}`
    return layout(context, {
        title: 'Gaps · darkgrade compatibility',
        description: 'darkgrade library and data gaps per camera manufacturer and line.',
        page: 'gaps',
        body,
        breadcrumbs: [['All', context.base], ['Gaps']],
    })
}

export function renderNotFound(context: PageContext, message: string): string {
    return layout(context, {
        title: 'Not found · darkgrade compatibility',
        description: message,
        page: 'not-found',
        body: `<h1>Not found</h1><p>${escapeHtml(message)}</p>`,
    })
}
