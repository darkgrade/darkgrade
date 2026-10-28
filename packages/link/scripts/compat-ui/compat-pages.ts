/**
 * HTML for the compatibility UI. Pure string rendering with no Node or DOM dependencies, so the
 * server, the static export and the browser (for live row updates) render rows identically.
 */
import { slug } from '@scripts/camera-profiles/catalog-names'
import type { CompatFilters } from './compat-filters'
import { FIDELITIES, KINDS, serializeFilters, TRANSPORTS } from './compat-filters'
import type { GapReport, LineGaps } from './compat-gaps'
import { nextStep } from './compat-gaps'
import {
    CELL_STATUSES,
    rowProgress,
    type CellStatus,
    type CompatView,
    type RunSummary,
    type ViewCell,
    type ViewRow,
} from './compat-view'

export interface PageContext {
    /** URL prefix ending in "/": "/" for the server, the hosting path for a static export. */
    base: string
    /** The local server can stream progress and start runs; a static export cannot. */
    live: boolean
}

export const STATUS_GLYPHS: Record<CellStatus, string> = {
    pass: '✓',
    fail: '✗',
    unsupported: '–',
    'no-data': '·',
    running: '◐',
    queued: '○',
}

const STATUS_LABELS: Record<CellStatus, string> = {
    pass: 'pass',
    fail: 'fail',
    unsupported: 'unsupported',
    'no-data': 'no data',
    running: 'running',
    queued: 'queued',
}

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`)
}

const attribute = escapeHtml

function formatTime(iso: string | undefined): string {
    if (!iso) return ''
    return iso.slice(0, 16).replace('T', ' ')
}

function transportLabel(transport: string): string {
    return transport === 'ptp-ip' ? 'PTP/IP' : 'USB'
}

export function fidelityBadge(row: Pick<ViewRow, 'fidelity' | 'scope'>): string {
    const scope = row.fidelity === 'documented' && row.scope ? ` <span class="muted">${row.scope}</span>` : ''
    return `<span class="badge f-${attribute(row.fidelity)}">${escapeHtml(row.fidelity)}</span>${scope}`
}

export function cameraHref(context: PageContext, profile: string): string {
    return `${context.base}camera/${encodeURIComponent(profile)}`
}

export function manufacturerHref(context: PageContext, manufacturerSlug: string, lineSlug?: string): string {
    return `${context.base}m/${manufacturerSlug}${lineSlug ? `/${lineSlug}` : ''}`
}

function evidenceDescription(cell: ViewCell | undefined): string {
    const evidence = cell?.evidence
    if (!evidence) return 'Evidence source unavailable'
    return [
        evidence.fidelity,
        evidence.profile,
        evidence.firmware ? `firmware ${evidence.firmware}` : 'firmware unknown',
        evidence.host,
        evidence.generatedAt,
        evidence.revision,
        ...(evidence.conflicts?.map(
            conflict => `conflict: ${conflict.status} from ${conflict.profile} at ${conflict.generatedAt}`
        ) ?? []),
    ]
        .filter(Boolean)
        .join(' · ')
}

export function renderCellEvidence(cell: ViewCell | undefined): string {
    if (!cell || cell.status === 'queued' || cell.status === 'running') return ''
    const evidence = cell.evidence
    if (!evidence) return '<span class="badge warn">source unavailable</span>'
    return `${evidence.conflicts?.length ? '<span class="badge warn">conflicting evidence</span> ' : ''}${fidelityBadge(evidence)} <span class="muted small">${escapeHtml(evidenceDescription(cell))}</span>`
}

export function renderDetailCellContents(cell: ViewCell | undefined): string {
    const status = cell?.status ?? 'no-data'
    return `<span class="glyph">${STATUS_GLYPHS[status]}</span> <b>${STATUS_LABELS[status]}</b><div class="why">${escapeHtml(cell?.detail ?? '')}</div><div class="cell-evidence">${renderCellEvidence(cell)}</div>`
}

export function renderCell(
    cell: ViewCell | undefined,
    capability: { id: string; label: string },
    rowFidelity?: ViewRow['fidelity']
): string {
    const status = cell?.status ?? 'no-data'
    const detail = cell?.detail && cell.detail.length > 120 ? `${cell.detail.slice(0, 119)}…` : cell?.detail
    const title = `${capability.label}: ${STATUS_LABELS[status]}${detail ? ` — ${detail}` : ''} · ${evidenceDescription(cell)}`
    const fallback =
        cell?.evidence && rowFidelity && cell.evidence.fidelity !== rowFidelity
            ? ` ${fidelityBadge(cell.evidence)}`
            : ''
    const unknown =
        cell && !cell.evidence && rowFidelity && status !== 'queued' && status !== 'running'
            ? ' <span class="badge warn">source unavailable</span>'
            : ''
    return `<td class="c s-${status}" data-capability="${attribute(capability.id)}" title="${attribute(title)}">${STATUS_GLYPHS[status]}${fallback}${unknown}</td>`
}

export function renderRow(row: ViewRow, capabilities: { id: string; label: string }[], context: PageContext): string {
    const progress = rowProgress(row, capabilities.length)
    const progressCell =
        row.state === 'idle'
            ? ''
            : `<span class="meter"><span style="width:${Math.round((progress.done / progress.total) * 100)}%"></span></span> ${progress.done}/${progress.total}`
    return [
        `<tr data-key="${attribute(row.key)}" class="r-${row.state}">`,
        `<td class="model"><a href="${attribute(cameraHref(context, row.profile))}">${escapeHtml(row.model)}</a></td>`,
        `<td><a href="${attribute(manufacturerHref(context, row.manufacturerSlug))}">${escapeHtml(row.manufacturer)}</a></td>`,
        `<td><a href="${attribute(manufacturerHref(context, row.manufacturerSlug, row.lineSlug))}">${escapeHtml(row.line)}</a></td>`,
        `<td>${fidelityBadge(row)}</td>`,
        `<td>${transportLabel(row.transport)}</td>`,
        `<td class="center" title="${row.unverified ? `${row.unverifiedQuirks} unverified quirks or catalog entry` : ''}">${row.unverified ? '!' : ''}</td>`,
        `<td class="progress">${progressCell}</td>`,
        ...capabilities.map(capability => renderCell(row.cells[capability.id], capability, row.fidelity)),
        `<td class="time" title="${attribute(row.lastRun ?? '')}">${formatTime(row.lastRun)}</td>`,
        '</tr>',
    ].join('')
}

function statusTotals(rows: ViewRow[]): Record<CellStatus, number> {
    const totals = Object.fromEntries(CELL_STATUSES.map(status => [status, 0])) as Record<CellStatus, number>
    for (const row of rows) for (const cell of Object.values(row.cells)) totals[cell.status] += 1
    return totals
}

export function renderCounts(rows: ViewRow[], total: number): string {
    const totals = statusTotals(rows)
    const parts = CELL_STATUSES.filter(status => totals[status]).map(
        status => `<span class="s-${status}">${STATUS_GLYPHS[status]} ${totals[status]} ${STATUS_LABELS[status]}</span>`
    )
    return `<strong>${rows.length}</strong> of ${total} rows · ${parts.join(' · ')}`
}

export function renderProgress(run: RunSummary | undefined, context: PageContext): string {
    if (!run) return ''
    const percent = run.cells ? Math.round((run.finishedCells / run.cells) * 100) : 0
    const current = run.current
        ? ` · now <code>${escapeHtml(run.current.key.split('/').at(-1)!)}</code> ${escapeHtml(run.current.capability)}`
        : ''
    const label = run.source === 'hardware' ? 'Hardware run' : 'Simulation run'
    return [
        `<div class="run-progress" data-run="${attribute(run.runId)}">`,
        `<span class="meter wide"><span style="width:${percent}%"></span></span>`,
        `<span><strong>${label}</strong> ${run.finishedRows}/${run.rows} rows · ${run.finishedCells}/${run.cells} checks (${percent}%)`,
        ` · ✓ ${run.counts.pass} ✗ ${run.counts.fail} – ${run.counts.unsupported} · ${run.counts['no-data']}${current}`,
        run.filter ? ` · filter <code>${escapeHtml(run.filter)}</code>` : '',
        ` · <a href="${context.base}runs">runs</a></span>`,
        '</div>',
    ].join('')
}

function layout(
    context: PageContext,
    options: { title: string; description: string; page: string; body: string; breadcrumbs?: [string, string?][] }
): string {
    const crumbs = options.breadcrumbs?.length
        ? `<nav class="crumbs">${options.breadcrumbs
              .map(([label, href]) =>
                  href ? `<a href="${attribute(href)}">${escapeHtml(label)}</a>` : escapeHtml(label)
              )
              .join(' / ')}</nav>`
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
<body data-base="${attribute(context.base)}" data-live="${context.live}" data-page="${options.page}">
<header class="top">
<a class="brand" href="${context.base}">darkgrade · camera compatibility</a>
<nav><a href="${context.base}">All cameras</a><a href="${context.base}gaps">Gaps</a><a href="${context.base}runs">Runs</a></nav>
<span id="live-status" class="muted">${context.live ? 'local' : 'static export'}</span>
</header>
<main>
${crumbs}
${options.body}
</main>
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
    context: PageContext,
    filters: CompatFilters,
    id: string,
    label: string,
    routePath: string
): string {
    const active = filters.sort === id
    const order = active && filters.order === 'asc' ? 'desc' : 'asc'
    const query = serializeFilters({ ...filters, sort: id, order }, ['manufacturer', 'line'])
    const arrow = active ? (filters.order === 'desc' ? ' ↓' : ' ↑') : ''
    return `<a class="sort" data-sort="${id}" href="${attribute(`${routePath}?${query}`)}">${escapeHtml(label)}${arrow}</a>`
}

function option(value: string, label: string, selected: boolean): string {
    return `<option value="${attribute(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`
}

export function routePath(context: PageContext, route: { manufacturer?: string; line?: string }): string {
    return route.manufacturer ? manufacturerHref(context, route.manufacturer, route.line) : context.base
}

function filterBar(context: PageContext, input: TablePageInput): string {
    const { filters, route } = input
    const fidelity = FIDELITIES.map(
        value =>
            `<label><input type="checkbox" name="fidelity" value="${value}"${filters.fidelity.includes(value) ? ' checked' : ''}> ${value}</label>`
    ).join('')
    return `<form id="filters" class="filters" method="get" action="${attribute(routePath(context, route))}">
<input type="search" name="q" placeholder="Search model, profile, VID:PID" value="${attribute(filters.q ?? '')}">
<select name="manufacturer" data-route="manufacturer">${option('', 'All manufacturers', !route.manufacturer)}${input.manufacturers
        .map(entry => option(entry.slug, `${entry.name} (${entry.rows})`, entry.slug === route.manufacturer))
        .join('')}</select>
<select name="line" data-route="line"${route.manufacturer ? '' : ' disabled'}>${option('', 'All lines', !route.line)}${input.lines
        .map(entry => option(entry.slug, `${entry.name} (${entry.rows})`, entry.slug === route.line))
        .join('')}</select>
<span class="group">${fidelity}</span>
<select name="transport">${option('', 'Any link', !filters.transport.length)}${TRANSPORTS.map(value =>
        option(value, transportLabel(value), filters.transport.length === 1 && filters.transport[0] === value)
    ).join('')}</select>
<select name="kind">${option('', 'Any kind', !filters.kind.length)}${KINDS.map(value =>
        option(
            value,
            value === 'profile' ? 'captured / hardware' : `${value} mocks`,
            filters.kind.length === 1 && filters.kind[0] === value
        )
    ).join('')}</select>
<select name="unverified">${option('', 'Verified or not', !filters.unverified)}${option('yes', 'Unverified only', filters.unverified === 'yes')}${option('no', 'Verified only', filters.unverified === 'no')}</select>
${filters.sort ? `<input type="hidden" name="sort" value="${attribute(filters.sort)}"><input type="hidden" name="order" value="${filters.order}">` : ''}
${filters.run ? `<input type="hidden" name="run" value="${attribute(filters.run)}">` : ''}
${filters.profile.length ? `<input type="hidden" name="profile" value="${attribute(filters.profile.join(','))}">` : ''}
<noscript><button type="submit">Apply</button></noscript>
<a class="reset" href="${attribute(routePath(context, route))}">Reset</a>
${context.live ? '<button type="button" id="run-view" title="Run the simulation suite for the rows this view selects">Run simulation for this view</button>' : ''}
</form>`
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
                `<th><select form="filters" name="${attribute(capability.id)}" aria-label="${attribute(capability.label)} status">${option('', 'any', !filters.status[capability.id])}${CELL_STATUSES.map(
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
        ['model', 'Model'],
        ['manufacturer', 'Manufacturer'],
        ['line', 'Line'],
        ['fidelity', 'Fidelity'],
        ['transport', 'Link'],
        ['unverified', 'Unv.'],
    ]
        .map(([id, label]) => `<th>${sortHeader(context, filters, id, label, path)}</th>`)
        .join('')
    const lineChips =
        route.manufacturer && !route.line
            ? `<p class="chips">${input.lines
                  .map(
                      entry =>
                          `<a href="${attribute(manufacturerHref(context, route.manufacturer!, entry.slug))}">${escapeHtml(entry.name)} <span class="muted">${entry.rows}</span></a>`
                  )
                  .join('')}</p>`
            : ''
    const body = `
<h1>${escapeHtml(title)}</h1>
${input.lineFacts ? `<p class="muted">${input.lineFacts}</p>` : ''}
${lineChips}
${filterBar(context, input)}
<div id="progress">${renderProgress(view.activeRun, context)}</div>
<p id="counts" class="counts">${renderCounts(rows, view.rows.length)}</p>
<div class="table-wrap">
<table class="matrix">
<thead>
<tr>${header}<th>Progress</th>${capabilities.map(capability => `<th class="cap">${sortHeader(context, filters, capability.id, capability.label, path)}</th>`).join('')}<th>${sortHeader(context, filters, 'last-run', 'Last run', path)}</th></tr>
<tr class="status-filters"><th colspan="7"></th>${statusFilters}<th></th></tr>
</thead>
<tbody id="rows">
${rows.map(row => renderRow(row, capabilities, context)).join('\n')}
</tbody>
</table>
</div>
<p class="legend">✓ pass · ✗ fail · – unsupported (camera refused it or darkgrade has no definition) · · no data (the profile holds no response; nothing is invented) · ◐ running · ○ queued. Fidelity: <b>hardware</b> ran on a physical camera, <b>captured</b> replays recorded evidence, <b>documented</b> is built from libgphoto2 and vendor documentation and is not hardware-verified. ! marks rows whose catalog entry or quirks are unverified.</p>`
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
    })
}

export interface CameraPageInput {
    profileId: string
    model: string
    manufacturer: string
    line: string
    capabilities: { id: string; label: string }[]
    facts: [string, string][]
    results: {
        key: string
        label: string
        source: string
        at: string
        cells: Record<string, ViewCell>
    }[]
    related: { profile: string; model: string; fidelity: string; path: string }[]
    quirks: { id: string; description: string; behaviour: string; unverified: boolean; citation: string }[]
    exchanges: { operation: string; parameters: string; response: string; note: string; citation: string }[]
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

export function renderCameraPage(context: PageContext, input: CameraPageInput): string {
    const manufacturerSlug = slug(input.manufacturer)
    const lineSlug = slug(input.line)
    const resultHeader = input.results.map(
        result =>
            `<th>${escapeHtml(result.label)}<div class="muted small">${escapeHtml(result.source)} · ${formatTime(result.at)}</div></th>`
    )
    const resultRows = input.capabilities.map(capability => {
        const cells = input.results.map(result => {
            const cell = result.cells[capability.id]
            const status = cell?.status ?? 'no-data'
            return `<td class="detail s-${status}" data-key="${attribute(result.key)}" data-capability="${attribute(capability.id)}">${renderDetailCellContents(cell)}</td>`
        })
        return `<tr><th scope="row">${escapeHtml(capability.label)}</th>${cells.join('')}</tr>`
    })
    const history = input.history.length
        ? `<table class="matrix compact"><thead><tr><th>Run</th><th>When</th><th>Tier · link</th>${input.capabilities.map(capability => `<th class="cap">${escapeHtml(capability.label)}</th>`).join('')}</tr></thead><tbody>${input.history
              .map(
                  entry =>
                      `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(entry.runId)}&profile=${encodeURIComponent(input.profileId)}`)}"><code>${escapeHtml(entry.runId)}</code></a></td><td class="time">${formatTime(entry.at)}</td><td>${escapeHtml(entry.label)}</td>${input.capabilities
                          .map(capability => renderCell(entry.cells[capability.id], capability))
                          .join('')}</tr>`
              )
              .join('')}</tbody></table>`
        : '<p class="muted">No run logs mention this profile yet. Runs started with <code>test:simulation</code>, <code>compat:hardware</code> or the Run button appear here.</p>'
    const body = `
<h1>${escapeHtml(input.model)}</h1>
<p class="muted"><a href="${attribute(manufacturerHref(context, manufacturerSlug))}">${escapeHtml(input.manufacturer)}</a> · <a href="${attribute(manufacturerHref(context, manufacturerSlug, lineSlug))}">${escapeHtml(input.line)}</a> · <code>${escapeHtml(input.profileId)}</code></p>
<div id="progress">${renderProgress(input.activeRun, context)}</div>
<dl class="facts">${input.facts.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${value}</dd>`).join('')}</dl>
<h2>Results</h2>
${input.results.length ? `<div class="table-wrap"><table class="matrix detail-table"><thead><tr><th>Capability</th>${resultHeader.join('')}</tr></thead><tbody>${resultRows.join('')}</tbody></table></div>` : '<p class="muted">No results yet for this profile.</p>'}
${input.related.length ? `<h2>Same USB identity</h2><ul>${input.related.map(entry => `<li><a href="${attribute(cameraHref(context, entry.profile))}">${escapeHtml(entry.model)}</a> <span class="badge f-${entry.fidelity}">${entry.fidelity}</span> <code>${escapeHtml(entry.path)}</code></li>`).join('')}</ul>` : ''}
<h2>Run history</h2>
${history}
<h2>Quirks</h2>
${input.quirks.length ? `<table class="list"><thead><tr><th>Quirk</th><th>Description</th><th>Simulated as</th><th>Source</th></tr></thead><tbody>${input.quirks.map(quirk => `<tr><td><code>${escapeHtml(quirk.id)}</code>${quirk.unverified ? ' <span class="badge warn">unverified</span>' : ''}</td><td>${escapeHtml(quirk.description)}</td><td><code>${escapeHtml(quirk.behaviour)}</code></td><td class="small">${quirk.citation}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None recorded.</p>'}
<h2>Recorded exchanges</h2>
${input.exchanges.length ? `<table class="list"><thead><tr><th>Request</th><th>Response</th><th>Note</th><th>Source</th></tr></thead><tbody>${input.exchanges.map(exchange => `<tr><td><code>${escapeHtml(exchange.operation)} ${escapeHtml(exchange.parameters)}</code></td><td><code>${escapeHtml(exchange.response)}</code></td><td>${escapeHtml(exchange.note)}</td><td class="small">${exchange.citation}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">None recorded.</p>'}
<h2>Provenance</h2>
<ol start="0" class="sources">${input.sources.map(source => `<li>${linkify(source.location)}${source.excerpt ? `<blockquote>${escapeHtml(source.excerpt)}</blockquote>` : ''}</li>`).join('')}</ol>`
    return layout(context, {
        title: `${input.model} · darkgrade compatibility`,
        description: `darkgrade compatibility results, USB identity, quirks and provenance for ${input.manufacturer} ${input.model}.`,
        page: 'camera',
        body,
        breadcrumbs: [
            ['All', context.base],
            [input.manufacturer, manufacturerHref(context, manufacturerSlug)],
            [input.line, manufacturerHref(context, manufacturerSlug, lineSlug)],
            [input.model],
        ],
    })
}

export function citation(sources: { location: string; excerpt?: string }[], index: number): string {
    const source = sources[index]
    if (!source) return ''
    return `[${index}] ${linkify(source.location)}`
}

export function renderRunsPage(
    context: PageContext,
    input: { view: CompatView; matrices: { id: string; label: string; generatedAt: string; rows: number }[] }
): string {
    const runRows = input.view.runs.map(
        run =>
            `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(run.runId)}`)}"><code>${escapeHtml(run.runId)}</code></a></td><td>${run.source}</td><td class="time">${formatTime(run.startedAt)}</td><td>${run.outcome ?? (input.view.activeRun?.runId === run.runId ? 'running' : '')}</td><td>${run.finishedRows}/${run.rows}</td><td>✓ ${run.counts.pass} ✗ ${run.counts.fail} – ${run.counts.unsupported} · ${run.counts['no-data']}</td><td>${run.filter ? `<code>${escapeHtml(run.filter)}</code>` : 'all'}</td></tr>`
    )
    const matrixRows = input.matrices.map(
        matrix =>
            `<tr><td><a href="${attribute(`${context.base}?run=${encodeURIComponent(matrix.id)}`)}">${escapeHtml(matrix.label)}</a></td><td class="time">${formatTime(matrix.generatedAt)}</td><td>${matrix.rows}</td></tr>`
    )
    const controls = context.live
        ? `<h2>Start or load</h2>
<form id="run-form" class="filters"><input name="filter" placeholder="Filter, e.g. manufacturer=sony&amp;transport=ptp-ip (empty = everything)" size="60"><button type="submit">Run simulation</button></form>
<form id="import-form" class="filters"><input type="file" name="file" accept=".json,.jsonl"><button type="submit">Load results file</button></form>
<p class="muted">Loads a run log (<code>*.jsonl</code>) or a support matrix (<code>*.json</code>) from a past or remote run. For hardware results that should feed the merged matrix, use <code>bun run compat:ingest -- --results &lt;file&gt;</code>.</p>`
        : ''
    const body = `<h1>Runs and result files</h1>
<div id="progress">${renderProgress(input.view.activeRun, context)}</div>
${controls}
<h2>Run logs</h2>
${runRows.length ? `<table class="list"><thead><tr><th>Run</th><th>Source</th><th>Started</th><th>Outcome</th><th>Rows</th><th>Checks</th><th>Filter</th></tr></thead><tbody>${runRows.join('')}</tbody></table>` : '<p class="muted">No run logs yet. Run <code>bun run test:simulation</code> or <code>bun run compat:hardware</code>.</p>'}
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
    const href = manufacturerHref(context, slug(line.manufacturer.replace(/ \(other\)$/, '')), slug(line.line))
    return `<tr><td>${escapeHtml(line.manufacturer)}</td><td><a href="${attribute(href)}">${escapeHtml(line.line)}</a></td><td>${line.models}</td><td>${line.mockedModels}${line.documentedMock ? '' : ' <span class="badge warn">no line mock</span>'}</td><td>${[...line.capturedProfiles, ...line.hardwareProfiles.map(profile => `${profile} (hw)`)].map(profile => `<a href="${attribute(cameraHref(context, profile.replace(' (hw)', '')))}">${escapeHtml(profile)}</a>`).join(', ') || '-'}</td><td>${line.noDataCells}/${line.cells}</td><td>${[line.unverifiedModels.length ? `${line.unverifiedModels.length} models` : '', ...line.unverifiedQuirks].filter(Boolean).map(escapeHtml).join(', ') || '-'}</td><td class="small">${escapeHtml(line.ptpIp ?? '-')}</td><td class="small">${escapeHtml(nextStep(line))}</td></tr>`
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
<h2>darkgrade library gaps</h2>
<p>Vendor classes: ${report.manufacturers.map(manufacturer => `${escapeHtml(manufacturer.name)} ${manufacturer.vendorDefinitions ? 'defined' : '<b>missing</b>'}`).join(' · ')}.</p>
<table class="list"><thead><tr><th>Manufacturer</th><th>Line</th><th>Undefined vendor operations</th><th>Inexpressible recorded requests</th><th>Undefined events</th></tr></thead><tbody>${library
        .map(
            line =>
                `<tr><td>${escapeHtml(line.manufacturer)}</td><td>${escapeHtml(line.line)}</td><td><code>${line.undefinedVendorOperations.join(' ') || '-'}</code></td><td><code>${escapeHtml(line.inexpressibleRequests.join(', ') || '-')}</code></td><td><code>${line.undefinedEvents.join(' ') || '-'}</code></td></tr>`
        )
        .join('')}</tbody></table>
<h2>Data gaps</h2>
<table class="list"><thead><tr><th>Manufacturer</th><th>Line</th><th>Models</th><th>Mocked</th><th>Captured / hardware</th><th>No data</th><th>Unverified</th><th>PTP/IP</th><th>Next step</th></tr></thead><tbody>${lines.map(line => gapRow(context, line)).join('')}</tbody></table>
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
