/**
 * Browser side of the compatibility UI. Pages arrive fully rendered from the server (or the static
 * export); this script keeps filters and sorting in the URL without reloading, follows back/forward,
 * and applies live progress from the local server's event stream.
 */
import { applyFilters, parseFilters, serializeFilters, type CompatFilters } from './compat-filters'
import {
    manufacturerHref,
    renderCounts,
    renderDetailCellContents,
    renderProgress,
    renderRow,
    routePath,
    type PageContext,
} from './compat-pages'
import type { CompatView, RunSummary, ViewRow } from './compat-view'

const body = document.body
const context: PageContext = { base: body.dataset.base ?? '/', live: body.dataset.live === 'true' }
const page = body.dataset.page
const pinnedRun = new URLSearchParams(location.search).get('run')
let view: CompatView | undefined

function route(): { manufacturer?: string; line?: string } {
    const segments = location.pathname.slice(context.base.length).split('/').filter(Boolean)
    if (segments[0] !== 'm') return {}
    return { ...(segments[1] && { manufacturer: segments[1] }), ...(segments[2] && { line: segments[2] }) }
}

function capabilityIds(): string[] {
    return view?.capabilities.map(capability => capability.id) ?? []
}

function currentFilters(): CompatFilters {
    return { ...parseFilters(location.search, capabilityIds()), ...route() }
}

async function loadView(): Promise<CompatView> {
    const url = context.live
        ? `${context.base}api/view${pinnedRun ? `?run=${encodeURIComponent(pinnedRun)}` : ''}`
        : `${context.base}view.json`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    return (await response.json()) as CompatView
}

function renderTable(): void {
    const tbody = document.getElementById('rows')
    if (!view || !tbody) return
    const filters = currentFilters()
    const rows = applyFilters(view.rows, filters)
    tbody.innerHTML = rows.map(row => renderRow(row, view!.capabilities, context)).join('')
    const counts = document.getElementById('counts')
    if (counts) counts.innerHTML = renderCounts(rows, view.rows.length)
    updateSortHeaders(filters)
}

function updateSortHeaders(filters: CompatFilters): void {
    const path = routePath(context, route())
    for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a.sort'))) {
        const id = link.dataset.sort!
        const active = filters.sort === id
        const order = active && filters.order === 'asc' ? 'desc' : 'asc'
        link.href = `${path}?${serializeFilters({ ...filters, sort: id, order }, ['manufacturer', 'line'])}`
        const label = link.textContent.replace(/ [↑↓]$/, '')
        link.textContent = active ? `${label} ${filters.order === 'desc' ? '↓' : '↑'}` : label
    }
}

function formFilters(form: HTMLFormElement): CompatFilters {
    const data = new FormData(form)
    const parameters = new URLSearchParams()
    data.forEach((value, key) => {
        if (typeof value !== 'string' || !value || key === 'manufacturer' || key === 'line') return
        parameters.set(key, parameters.has(key) ? `${parameters.get(key)},${value}` : value)
    })
    return parseFilters(parameters, capabilityIds())
}

function syncForm(form: HTMLFormElement): void {
    const filters = currentFilters()
    for (const element of Array.from(form.elements).concat(
        Array.from(document.querySelectorAll<HTMLSelectElement>('select[form="filters"]'))
    )) {
        if (element instanceof HTMLInputElement && element.type === 'checkbox' && element.name === 'fidelity') {
            element.checked = filters.fidelity.includes(element.value)
        } else if (element instanceof HTMLInputElement && element.name === 'q') {
            element.value = filters.q ?? ''
        } else if (element instanceof HTMLSelectElement && !element.dataset.route) {
            const key = element.name as keyof CompatFilters
            const value =
                key === 'transport' || key === 'kind'
                    ? filters[key][0]
                    : key === 'unverified'
                      ? filters.unverified
                      : filters.status[element.name]?.[0]
            element.value = value ?? ''
        }
    }
}

function navigate(filters: CompatFilters, replace = false): void {
    const query = serializeFilters(filters, ['manufacturer', 'line'])
    const url = `${routePath(context, route())}${query ? `?${query}` : ''}`
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
    renderTable()
}

function wireTable(): void {
    const form = document.getElementById('filters') as HTMLFormElement | null
    if (!form) return
    let typing: ReturnType<typeof setTimeout> | undefined
    const onChange = (event: Event) => {
        const target = event.target as HTMLInputElement | HTMLSelectElement
        if (target.dataset.route) {
            const manufacturer = target.dataset.route === 'manufacturer' ? target.value : route().manufacturer
            const line = target.dataset.route === 'line' ? target.value : undefined
            const query = serializeFilters(formFilters(form), ['manufacturer', 'line'])
            const path = manufacturer ? manufacturerHref(context, manufacturer, line || undefined) : context.base
            location.href = `${path}${query ? `?${query}` : ''}`
            return
        }
        const filters = {
            ...currentFilters(),
            ...formFilters(form),
            sort: currentFilters().sort,
            order: currentFilters().order,
        }
        if (target.name === 'q') {
            clearTimeout(typing)
            typing = setTimeout(() => navigate(filters, true), 200)
            return
        }
        navigate(filters)
    }
    // Typing searches as you go (replacing history); every other control adds one history entry.
    form.addEventListener('input', event => {
        if ((event.target as HTMLInputElement).name === 'q') onChange(event)
    })
    form.addEventListener('change', event => {
        if ((event.target as HTMLInputElement).name !== 'q') onChange(event)
    })
    for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>('select[form="filters"]'))) {
        select.addEventListener('change', onChange)
    }
    form.addEventListener('submit', event => event.preventDefault())
    document.querySelector('thead')?.addEventListener('click', event => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.sort')
        if (!link) return
        event.preventDefault()
        history.pushState(null, '', link.href)
        renderTable()
    })
    window.addEventListener('popstate', () => {
        syncForm(form)
        renderTable()
    })
    document.getElementById('run-view')?.addEventListener('click', () => {
        const filters = currentFilters()
        const scope = serializeFilters({ ...filters, status: {}, sort: undefined, order: 'asc', run: undefined })
        void startRun(scope)
    })
}

async function startRun(filter: string): Promise<void> {
    const response = await fetch(`${context.base}api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filter }),
    })
    const result = (await response.json()) as { message: string }
    setStatus(result.message)
}

function setStatus(message: string): void {
    const status = document.getElementById('live-status')
    if (status) status.textContent = message
}

function updateCameraCells(rows: ViewRow[]): void {
    for (const row of rows) {
        for (const [capability, cell] of Object.entries(row.cells)) {
            const target = document.querySelector<HTMLTableCellElement>(
                `td.detail[data-key="${CSS.escape(row.key)}"][data-capability="${CSS.escape(capability)}"]`
            )
            if (!target) continue
            target.className = `detail s-${cell.status}`
            target.innerHTML = renderDetailCellContents(cell)
        }
    }
}

function showProgress(run: RunSummary | undefined): void {
    const progress = document.getElementById('progress')
    if (progress) progress.innerHTML = renderProgress(run, context)
}

const early: ViewRow[][] = []

function mergeRows(rows: ViewRow[]): void {
    if (!view) return
    const index = new Map(view.rows.map((row, position) => [row.key, position]))
    for (const row of rows) {
        const position = index.get(row.key)
        if (position === undefined) view.rows.push(row)
        else view.rows[position] = row
    }
}

function subscribe(): void {
    const source = new EventSource(`${context.base}api/events`)
    let pending: ReturnType<typeof setTimeout> | undefined
    source.addEventListener('progress', event => {
        const run = JSON.parse(event.data) as RunSummary | null
        if (view) view.activeRun = run ?? undefined
        showProgress(run ?? undefined)
        setStatus(run ? 'live · run in progress' : 'live')
    })
    source.addEventListener('rows', event => {
        const rows = JSON.parse(event.data) as ViewRow[]
        if (page === 'camera') {
            updateCameraCells(rows.filter(row => location.pathname.endsWith(`/${encodeURIComponent(row.profile)}`)))
            return
        }
        if (page !== 'table') return
        if (!view) {
            early.push(rows)
            return
        }
        mergeRows(rows)
        clearTimeout(pending)
        pending = setTimeout(renderTable, 250)
    })
    source.addEventListener('reload', () => {
        if (page === 'camera' || page === 'runs') return location.reload()
        if (page !== 'table') return
        void loadView().then(loaded => {
            view = loaded
            showProgress(view.activeRun)
            renderTable()
        })
    })
    source.onerror = () => setStatus('live · reconnecting')
}

function wireRuns(): void {
    document.getElementById('run-form')?.addEventListener('submit', event => {
        event.preventDefault()
        const input = (event.target as HTMLFormElement).elements.namedItem('filter') as HTMLInputElement
        void startRun(input.value.trim())
    })
    document.getElementById('import-form')?.addEventListener('submit', event => {
        event.preventDefault()
        void importResults(event)
    })
}

async function importResults(event: Event): Promise<void> {
    const input = (event.target as HTMLFormElement).elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const response = await fetch(`${context.base}api/import?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: await file.text(),
    })
    const result = (await response.json()) as { message: string; open?: string }
    setStatus(result.message)
    if (response.ok && result.open) location.href = result.open
}

async function main(): Promise<void> {
    // Subscribe before loading the view, so no change between the two is missed; row updates that
    // arrive before the view are replayed onto it.
    if (context.live && !pinnedRun && page !== 'gaps') subscribe()
    if (page === 'table') {
        view = await loadView()
        for (const rows of early.splice(0)) mergeRows(rows)
        wireTable()
        renderTable()
    }
    if (page === 'runs') wireRuns()
}

void main()
