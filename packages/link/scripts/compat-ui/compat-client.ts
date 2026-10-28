/**
 * Browser side of the compatibility UI. Pages arrive fully rendered from the server (or the static
 * export); this script keeps filters and sorting in the URL without reloading, follows back/forward,
 * opens a camera's details in a modal (deep-linkable as ?camera=<profile id>), and applies live
 * progress from the local server's event stream. Anything it receives may be malformed or hostile:
 * responses are checked before use, all HTML comes from the escaping renderers, and a failed request
 * or a dropped stream only changes the status line.
 */
import { applyFilters, matchesFilters, parseFilters, serializeFilters, type CompatFilters } from './compat-filters'
import { knownStatus } from './compat-icons'
import {
    cameraHref,
    detailCellContent,
    manufacturerHref,
    renderCounts,
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
const api = `${context.base}api/v1`
let view: CompatView | undefined

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

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

/** A view with the arrays every renderer relies on; rows that are not objects are dropped. */
function checkedView(value: unknown): CompatView {
    if (!isRecord(value) || !Array.isArray(value.rows) || !Array.isArray(value.capabilities)) {
        throw new Error('The results view is malformed')
    }
    return {
        ...(value as unknown as CompatView),
        rows: value.rows.filter(isRecord) as unknown as ViewRow[],
        capabilities: value.capabilities.filter(
            (capability): capability is { id: string; label: string } =>
                isRecord(capability) && typeof capability.id === 'string' && typeof capability.label === 'string'
        ),
        runs: Array.isArray(value.runs) ? (value.runs as RunSummary[]) : [],
    }
}

async function loadView(): Promise<CompatView> {
    const url = context.live
        ? `${api}/view${pinnedRun ? `?run=${encodeURIComponent(pinnedRun)}` : ''}`
        : `${context.base}view.json`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    return checkedView(parseJson(await response.text()))
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
        const arrow = link.querySelector('.arrow')
        if (arrow) arrow.textContent = active ? (filters.order === 'desc' ? ' ↓' : ' ↑') : ''
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
    const statusSelects = Array.from(document.querySelectorAll<HTMLSelectElement>('select[form="filters"]'))
    for (const element of [...Array.from(form.elements), ...statusSelects]) {
        if (element instanceof HTMLInputElement && element.type === 'checkbox') {
            const values =
                element.name === 'unverified' ? [filters.unverified ?? ''] : (filters[element.name as 'fidelity'] ?? [])
            element.checked = values.includes(element.value)
        } else if (element instanceof HTMLInputElement && element.name === 'q') {
            element.value = filters.q ?? ''
        } else if (element instanceof HTMLSelectElement && !element.dataset.route) {
            const value = element.name === 'kind' ? filters.kind[0] : filters.status[element.name]?.[0]
            element.value = value ?? ''
        }
    }
    showStatusFilters(Object.keys(filters.status).length > 0)
}

function navigate(filters: CompatFilters, replace = false): void {
    const query = serializeFilters(filters, ['manufacturer', 'line'])
    const url = `${routePath(context, route())}${query ? `?${query}` : ''}`
    if (replace) history.replaceState(null, '', url)
    else history.pushState(null, '', url)
    renderTable()
}

function showStatusFilters(show: boolean): void {
    document.getElementById('matrix')?.classList.toggle('show-status-filters', show)
    const toggle = document.getElementById('toggle-status-filters')
    toggle?.setAttribute('aria-pressed', String(show))
    toggle?.classList.toggle('active', show)
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
    document.getElementById('toggle-status-filters')?.addEventListener('click', () => {
        const table = document.getElementById('matrix')
        showStatusFilters(!table?.classList.contains('show-status-filters'))
    })
    document.querySelector('thead')?.addEventListener('click', event => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.sort')
        if (!link) return
        event.preventDefault()
        history.pushState(null, '', link.href)
        renderTable()
    })
    document.getElementById('rows')?.addEventListener('click', event => {
        const target = event.target as HTMLElement
        const link = target.closest('a')
        // Maker and line links go to their pages; the model link and the rest of the row open the modal.
        if (link && !link.classList.contains('open')) return
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        const row = target.closest<HTMLTableRowElement>('tr[data-profile]')
        if (!row?.dataset.profile) return
        event.preventDefault()
        void openCamera(row.dataset.profile, { push: true, opener: row.querySelector('a.open') })
    })
    window.addEventListener('popstate', () => {
        syncForm(form)
        renderTable()
        syncModal()
    })
    document.getElementById('run-view')?.addEventListener('click', () => {
        const filters = currentFilters()
        const scope = serializeFilters({ ...filters, status: {}, sort: undefined, order: 'asc', run: undefined })
        void startRun(scope)
    })
}

/* Camera modal */

let openProfile: string | undefined
let opener: HTMLElement | null = null
/** The row the modal was opened from, to find its link again after the table re-renders. */
let openerProfile: string | undefined
let modalRequest = 0

function modal(): HTMLDialogElement | null {
    return document.getElementById('camera-modal') as HTMLDialogElement | null
}

function cameraParameter(): string | null {
    return new URLSearchParams(location.search).get('camera')
}

function urlWithCamera(profile: string | undefined): string {
    const parameters = new URLSearchParams(location.search)
    if (profile) parameters.set('camera', profile)
    else parameters.delete('camera')
    const query = parameters.toString()
    return `${location.pathname}${query ? `?${query}` : ''}${location.hash}`
}

async function fetchCameraDetail(profile: string): Promise<Element> {
    const url = `${cameraHref(context, profile)}${pinnedRun ? `?run=${encodeURIComponent(pinnedRun)}` : ''}`
    const response = await fetch(url)
    const document = new DOMParser().parseFromString(await response.text(), 'text/html')
    const detail = document.getElementById('camera-detail')
    if (!response.ok || !detail) {
        const message = document.querySelector('main p')?.textContent || `No details for ${profile}.`
        const paragraph = document.createElement('p')
        paragraph.className = 'muted'
        paragraph.textContent = message
        return paragraph
    }
    return detail
}

async function openCamera(profile: string, options: { push: boolean; opener?: Element | null }): Promise<void> {
    const dialog = modal()
    if (!dialog) {
        location.href = cameraHref(context, profile)
        return
    }
    if (options.push) history.pushState({ camera: profile }, '', urlWithCamera(profile))
    if (!dialog.open) {
        opener = (options.opener as HTMLElement | null) ?? (document.activeElement as HTMLElement)
        openerProfile = opener?.closest<HTMLElement>('tr[data-profile]')?.dataset.profile
    }
    openProfile = profile
    const content = document.getElementById('modal-body')!
    const loading = document.createElement('p')
    loading.className = 'loading'
    loading.textContent = 'Loading…'
    content.replaceChildren(loading)
    document.getElementById('modal-page')?.setAttribute('href', cameraHref(context, profile))
    if (!dialog.open) dialog.showModal()
    content.focus()
    const request = ++modalRequest
    try {
        const detail = await fetchCameraDetail(profile)
        if (request !== modalRequest) return
        content.replaceChildren(document.importNode(detail, true))
        const title = content.querySelector('#camera-title')
        dialog.setAttribute('aria-labelledby', title ? 'camera-title' : '')
    } catch (error) {
        if (request !== modalRequest) return
        loading.textContent = `Could not load ${profile}: ${error instanceof Error ? error.message : String(error)}`
    }
}

function hideModal(): void {
    const dialog = modal()
    openProfile = undefined
    modalRequest += 1
    if (dialog?.open) dialog.close()
}

/** Closes the modal through history when it added an entry, so back and close agree. */
function closeCamera(): void {
    if (!modal()?.open) return
    if (isRecord(history.state) && history.state.camera === openProfile) {
        history.back()
        return
    }
    history.replaceState(null, '', urlWithCamera(undefined))
    hideModal()
}

function syncModal(): void {
    const profile = cameraParameter()
    if (profile && profile !== openProfile) void openCamera(profile, { push: false })
    else if (!profile) hideModal()
}

function wireModal(): void {
    const dialog = modal()
    if (!dialog) return
    dialog.addEventListener('cancel', event => {
        event.preventDefault()
        closeCamera()
    })
    dialog.addEventListener('click', event => {
        const target = event.target as HTMLElement
        // The dialog itself is only the target when the click lands on its backdrop.
        if (target === dialog || target.closest('[data-close]')) {
            closeCamera()
            return
        }
        const related = target.closest<HTMLAnchorElement>('a.open[data-profile]')
        if (related?.dataset.profile && !(event.metaKey || event.ctrlKey || event.shiftKey)) {
            event.preventDefault()
            void openCamera(related.dataset.profile, { push: true })
        }
    })
    dialog.addEventListener('close', () => {
        openProfile = undefined
        const target = opener?.isConnected
            ? opener
            : openerProfile
              ? document.querySelector<HTMLElement>(`#rows tr[data-profile="${CSS.escape(openerProfile)}"] a.open`)
              : null
        target?.focus()
        opener = null
        openerProfile = undefined
    })
}

/* Runs and other control actions */

function setStatus(message: string, offline = false): void {
    const status = document.getElementById('live-status')
    if (!status) return
    status.textContent = message
    status.classList.toggle('offline', offline)
}

const TOKEN_KEY = 'compat-api-token'

function storedToken(): string | null {
    try {
        return sessionStorage.getItem(TOKEN_KEY)
    } catch {
        return null
    }
}

/** A control request; when the server asks for a token, the user is asked once per session. */
async function control(path: string, init: RequestInit): Promise<{ ok: boolean; message: string; open?: string }> {
    const send = (token: string | null) =>
        fetch(`${api}${path}`, {
            ...init,
            headers: { ...(init.headers ?? {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        })
    let response = await send(storedToken())
    if (response.status === 401) {
        const token = prompt('This server needs its API token (COMPAT_API_TOKEN):')
        if (!token) return { ok: false, message: 'No token given' }
        try {
            sessionStorage.setItem(TOKEN_KEY, token)
        } catch {
            // Not stored: asked again next time.
        }
        response = await send(token)
    }
    const result = parseJson(await response.text())
    const message = isRecord(result) && typeof result.message === 'string' ? result.message : `HTTP ${response.status}`
    const open = isRecord(result) && typeof result.open === 'string' ? result.open : undefined
    return { ok: response.ok, message, ...(open && { open }) }
}

async function startRun(filter: string): Promise<void> {
    const result = await control('/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filter }),
    })
    setStatus(result.message)
}

function wireRuns(): void {
    document.getElementById('run-form')?.addEventListener('submit', event => {
        event.preventDefault()
        const input = (event.target as HTMLFormElement).elements.namedItem('filter') as HTMLInputElement
        void startRun(input.value.trim())
    })
    document.getElementById('cancel-run')?.addEventListener('click', () => {
        void control('/runs/active', { method: 'DELETE' }).then(result => setStatus(result.message))
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
    const result = await control(`/import?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: await file.text(),
    })
    setStatus(result.message)
    if (result.ok && result.open) location.href = result.open
}

/* Live updates */

function updateDetailCells(root: ParentNode, rows: ViewRow[]): void {
    for (const row of rows) {
        for (const [capability, cell] of Object.entries(row.cells ?? {})) {
            const target = root.querySelector<HTMLTableCellElement>(
                `td.detail[data-key="${CSS.escape(String(row.key))}"][data-capability="${CSS.escape(capability)}"]`
            )
            if (!target || !isRecord(cell)) continue
            const status = knownStatus(cell.status)
            target.className = `detail s-${status}`
            target.innerHTML = detailCellContent({
                status,
                detail: typeof cell.detail === 'string' ? cell.detail : '',
            })
        }
    }
}

function showProgress(run: RunSummary | undefined): void {
    for (const progress of Array.from(document.querySelectorAll('#progress, .camera-progress'))) {
        progress.innerHTML = renderProgress(run, context)
    }
    document.getElementById('matrix')?.classList.toggle('has-run', !!run)
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

async function reloadView(): Promise<void> {
    if (page !== 'table') return
    try {
        view = await loadView()
        showProgress(view.activeRun)
        renderTable()
    } catch (error) {
        setStatus(`live · ${error instanceof Error ? error.message : 'reload failed'}`, true)
    }
}

/** Sorts whose order does not depend on results, so a result update never moves a row. */
const STABLE_SORTS = [undefined, 'model', 'manufacturer', 'line', 'fidelity', 'transport', 'unverified']

/**
 * Applies changed rows in place: each visible row is swapped for its new rendering, keeping focus and
 * hover elsewhere in the table. When a change could add, remove or reorder rows, the table is redrawn.
 */
function patchRows(rows: ViewRow[]): boolean {
    if (!view) return false
    const filters = currentFilters()
    if (!STABLE_SORTS.includes(filters.sort)) return false
    const tbody = document.getElementById('rows')
    if (!tbody) return false
    const replacements: [HTMLTableRowElement, ViewRow][] = []
    for (const row of rows) {
        const existing = tbody.querySelector<HTMLTableRowElement>(`tr[data-key="${CSS.escape(String(row.key))}"]`)
        const shown = matchesFilters(row, filters)
        if (!existing && !shown) continue
        if (!existing || !shown) return false
        replacements.push([existing, row])
    }
    for (const [existing, row] of replacements) {
        const focused = existing.contains(document.activeElement)
        const template = document.createElement('template')
        template.innerHTML = `<table><tbody>${renderRow(row, view.capabilities, context)}</tbody></table>`
        const fresh = template.content.querySelector('tr')
        if (!fresh) continue
        existing.replaceWith(fresh)
        if (focused) fresh.querySelector<HTMLElement>('a.open')?.focus()
    }
    const counts = document.getElementById('counts')
    if (counts) counts.innerHTML = renderCounts(applyFilters(view.rows, filters), view.rows.length)
    return true
}

function onRows(rows: ViewRow[]): void {
    const detailRoots = [
        page === 'camera' ? document.getElementById('camera-detail') : null,
        openProfile ? document.getElementById('modal-body') : null,
    ].filter((root): root is HTMLElement => !!root)
    for (const root of detailRoots) {
        const profile = root.querySelector<HTMLElement>('#camera-detail')?.dataset.profile ?? root.dataset.profile
        updateDetailCells(
            root,
            rows.filter(row => row.profile === profile)
        )
    }
    if (page !== 'table') return
    if (!view) {
        early.push(rows)
        return
    }
    mergeRows(rows)
    pendingRows.push(...rows)
    clearTimeout(pendingRender)
    pendingRender = setTimeout(() => {
        const changed = pendingRows.splice(0)
        if (!patchRows(changed)) renderTable()
    }, 250)
}

let pendingRender: ReturnType<typeof setTimeout> | undefined
const pendingRows: ViewRow[] = []

function subscribe(): void {
    const source = new EventSource(`${api}/events`)
    let disconnected = false
    source.addEventListener('open', () => {
        // Changes made while the stream was down (or the server restarted) were never sent.
        if (disconnected) void reloadView()
        disconnected = false
    })
    source.addEventListener('progress', event => {
        const run = parseJson((event as MessageEvent<string>).data)
        const active = isRecord(run) ? (run as unknown as RunSummary) : undefined
        if (view) view.activeRun = active
        showProgress(active)
        setStatus(active ? 'live · run in progress' : 'live')
    })
    source.addEventListener('rows', event => {
        const rows = parseJson((event as MessageEvent<string>).data)
        if (Array.isArray(rows)) onRows(rows.filter(isRecord) as unknown as ViewRow[])
    })
    source.addEventListener('reload', () => {
        if (page === 'camera' || page === 'runs') return location.reload()
        void reloadView()
    })
    source.onerror = () => {
        disconnected = true
        setStatus('live · reconnecting', true)
    }
}

async function main(): Promise<void> {
    wireModal()
    // Subscribe before loading the view, so no change between the two is missed; row updates that
    // arrive before the view are replayed onto it.
    if (context.live && !pinnedRun && page !== 'gaps') subscribe()
    if (page === 'table') {
        wireTable()
        try {
            view = await loadView()
        } catch (error) {
            setStatus(`Could not load results: ${error instanceof Error ? error.message : String(error)}`, true)
            syncModal()
            return
        }
        for (const rows of early.splice(0)) mergeRows(rows)
        renderTable()
        syncModal()
    }
    if (page === 'runs') wireRuns()
}

void main()
