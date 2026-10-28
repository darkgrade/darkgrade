/**
 * The local compatibility UI server: renders the pages, serves the JSON API under /api/v1 (see
 * compat-openapi.ts), streams run progress over server-sent events, and runs control actions.
 * Bound to 127.0.0.1 unless told otherwise. Control requests (POST, DELETE) must come from a loopback
 * address with a loopback Host, carry no foreign Origin, and send the COMPAT_API_TOKEN bearer token
 * when one is configured, so a web page or another machine cannot start runs or write files.
 */
import { parseProgress } from '@scripts/camera-profiles/compat-progress'
import { matrixValue } from '@scripts/camera-profiles/compat-schema'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { ApiError, CompatApi, type CompatApiOptions } from './compat-api'
import { buildClientBundle, stylesheet } from './compat-assets'
import { CompatData } from './compat-data'
import { openApiDocument } from './compat-openapi'
import type { PageContext } from './compat-pages'
import { routePage } from './compat-site'
import type { CompatView } from './compat-view'

const TICK_MILLISECONDS = 700
const HEARTBEAT_MILLISECONDS = 15_000
const MAXIMUM_IMPORT_BYTES = 64 * 1024 * 1024
const MAXIMUM_CONTROL_BYTES = 1024 * 1024
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1']

export interface CompatServerOptions extends CompatApiOptions {
    host?: string
    port?: number
    /** Required on control requests when set (default: the COMPAT_API_TOKEN environment variable). */
    token?: string
    api?: CompatApi
}

export interface RunningServer {
    url: string
    server: Server
    api: CompatApi
    close: () => Promise<void>
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    response.end(body)
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
    send(response, status, 'application/json; charset=utf-8', JSON.stringify(value))
}

async function readBody(request: IncomingMessage, limit: number): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > limit) throw new ApiError(413, `The request body is larger than ${limit / 1024 / 1024} MB`)
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const text = await readBody(request, MAXIMUM_CONTROL_BYTES)
    if (!text.trim()) return {}
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch {
        throw new ApiError(400, 'The request body is not JSON')
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ApiError(400, 'The request body must be a JSON object')
    }
    return value as Record<string, unknown>
}

function isLoopbackAddress(address: string | undefined): boolean {
    return !!address && (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.'))
}

function hostName(host: string): string {
    return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
}

/** Throws unless a control request is local, same-origin and (when configured) carries the token. */
function authorizeControl(request: IncomingMessage, token: string | undefined): void {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
        throw new ApiError(403, 'Control endpoints only answer requests from this machine')
    }
    const host = request.headers.host ?? ''
    if (!LOOPBACK_HOSTS.includes(hostName(host))) {
        throw new ApiError(403, `Control endpoints only answer requests addressed to a loopback host, not ${host}`)
    }
    const origin = request.headers.origin
    if (origin && origin !== `http://${host}`) throw new ApiError(403, `Cross-origin control request from ${origin}`)
    const type = request.headers['content-type'] ?? ''
    if (request.method === 'POST' && !type.startsWith('application/json')) {
        throw new ApiError(415, 'Control requests need content-type: application/json')
    }
    if (token && request.headers.authorization !== `Bearer ${token}`) {
        throw new ApiError(401, 'This server needs Authorization: Bearer <COMPAT_API_TOKEN>')
    }
}

/** Watches result files and pushes changed rows and run progress to every open page. */
class LiveFeed {
    private clients = new Set<ServerResponse>()
    private timer?: ReturnType<typeof setInterval>
    private heartbeat?: ReturnType<typeof setInterval>
    private signature = ''
    private rows = new Map<string, string>()
    private activeRunId?: string

    constructor(private readonly data: CompatData) {}

    add(response: ServerResponse): void {
        response.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
        })
        response.write('retry: 2000\n\n')
        // The diff baseline is shared by all pages; only the first page sets it, so pages that are
        // already open never miss a change. A new page subscribes before it fetches the view.
        const view = this.safeView()
        if (!this.timer && view) this.remember(view)
        this.write(response, 'progress', view?.activeRun ?? null)
        this.clients.add(response)
        response.on('close', () => {
            this.clients.delete(response)
            if (this.clients.size === 0) this.stop()
        })
        this.timer ??= setInterval(() => this.tick(), TICK_MILLISECONDS)
        this.heartbeat ??= setInterval(() => this.ping(), HEARTBEAT_MILLISECONDS)
    }

    stop(): void {
        clearInterval(this.timer)
        clearInterval(this.heartbeat)
        this.timer = undefined
        this.heartbeat = undefined
        for (const client of this.clients) client.end()
        this.clients.clear()
    }

    private safeView(): CompatView | undefined {
        try {
            return this.data.view()
        } catch (error) {
            console.error(
                `compat-ui: could not read results: ${error instanceof Error ? error.message : String(error)}`
            )
            return undefined
        }
    }

    private write(response: ServerResponse, event: string, value: unknown): void {
        if (!response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
    }

    private broadcast(event: string, value: unknown): void {
        for (const client of this.clients) this.write(client, event, value)
    }

    private ping(): void {
        for (const client of this.clients) if (!client.writableEnded) client.write(': ping\n\n')
    }

    private currentSignature(): string {
        const modified = (file: string) => {
            try {
                return statSync(file).mtimeMs
            } catch {
                return 'missing'
            }
        }
        const files = [
            ...this.data.runFiles().map(run => `${run.file}:${run.size}:${run.modified}`),
            ...this.data.matrixFiles().map(matrix => `${matrix.file}:${modified(matrix.file)}`),
        ]
        return files.join('|')
    }

    private remember(view: CompatView): void {
        this.signature = this.currentSignature()
        this.rows = new Map(view.rows.map(row => [row.key, JSON.stringify(row)]))
        this.activeRunId = view.activeRun?.runId
    }

    /** One poll; a failure (a file vanishing mid-read) is logged and retried on the next tick. */
    private tick(): void {
        try {
            const signature = this.currentSignature()
            // A run whose process died stops being active without its file changing.
            if (signature === this.signature && !this.activeRunId) return
            const view = this.data.view()
            const changed = view.rows.filter(row => this.rows.get(row.key) !== JSON.stringify(row))
            const ended = this.activeRunId && view.activeRun?.runId !== this.activeRunId
            this.remember(view)
            if (changed.length) this.broadcast('rows', changed)
            this.broadcast('progress', view.activeRun ?? null)
            if (ended) this.broadcast('reload', {})
        } catch (error) {
            console.error(`compat-ui: live update failed: ${error instanceof Error ? error.message : String(error)}`)
        }
    }
}

function importFile(data: CompatData, name: string, text: string): { message: string; open?: string } {
    const safeName =
        path
            .basename(name)
            .replace(/[^A-Za-z0-9._-]/g, '_')
            .slice(0, 120) || 'results.json'
    if (safeName.endsWith('.jsonl')) {
        const start = parseProgress(text).find(event => event.type === 'run-start')
        if (!start) throw new ApiError(400, `${safeName} is not a compatibility run log`)
        const runFile = `${start.runId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`
        mkdirSync(data.runsDirectory, { recursive: true })
        writeFileSync(path.join(data.runsDirectory, runFile), text)
        return {
            message: `Loaded run ${start.runId}`,
            open: `/?run=${encodeURIComponent(path.basename(runFile, '.jsonl'))}`,
        }
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new ApiError(400, `${safeName} is not JSON`)
    }
    const matrix = matrixValue(parsed)
    if (!matrix || !matrix.capabilities.length) throw new ApiError(400, `${safeName} is not a support matrix`)
    mkdirSync(data.importsDirectory, { recursive: true })
    const file = path.join(data.importsDirectory, safeName.endsWith('.json') ? safeName : `${safeName}.json`)
    writeFileSync(file, text)
    const id = `matrix:${path.relative(data.resultsDirectory, file)}`
    return { message: `Loaded ${matrix.rows.length} rows from ${safeName}`, open: `/?run=${encodeURIComponent(id)}` }
}

const ENDPOINTS = [
    'GET /api/v1/cameras?<filters>',
    'GET /api/v1/cameras/{profile}',
    'GET /api/v1/view',
    'GET /api/v1/status',
    'GET /api/v1/runs',
    'GET /api/v1/runs/{runId}',
    'GET /api/v1/gaps',
    'GET /api/v1/gaps.md',
    'GET /api/v1/catalog',
    'GET /api/v1/profiles',
    'GET /api/v1/events (server-sent events)',
    'GET /api/v1/openapi.json',
    'POST /api/v1/runs {filter}',
    'DELETE /api/v1/runs/active',
    'POST /api/v1/ingest {captures, results, simulate, merge}',
    'POST /api/v1/import?name=<file>',
    'POST /api/v1/reports {targets}',
]

export async function startCompatServer(options: CompatServerOptions = {}): Promise<RunningServer> {
    const api = options.api ?? new CompatApi({ ...options, data: options.data ?? new CompatData() })
    const { data } = api
    const token = options.token ?? (process.env.COMPAT_API_TOKEN || undefined)
    const context: PageContext = { base: '/', live: true }
    const client = await buildClientBundle()
    const styles = stylesheet()
    const feed = new LiveFeed(data)

    const handleApi = async (request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> => {
        const parameters = url.searchParams
        const route = url.pathname.replace(/^\/api\/v1\/?/, '')
        const [resource, ...rest] = route.split('/').filter(Boolean)
        const id = rest.length ? decodeURIComponent(rest.join('/')) : undefined
        const method = request.method ?? 'GET'
        if (method === 'GET') {
            if (!resource)
                return sendJson(response, 200, { version: 'v1', endpoints: ENDPOINTS, openapi: '/api/v1/openapi.json' })
            if (resource === 'openapi.json') return sendJson(response, 200, openApiDocument)
            if (resource === 'events') return feed.add(response)
            if (resource === 'view') return sendJson(response, 200, api.view(parameters.get('run')))
            if (resource === 'cameras' && !id) return sendJson(response, 200, api.listCameras(parameters))
            if (resource === 'cameras' && id) return sendJson(response, 200, api.camera(id, parameters.get('run')))
            if (resource === 'status') return sendJson(response, 200, api.status())
            if (resource === 'runs' && !id) return sendJson(response, 200, api.runs(parameters.get('limit')))
            if (resource === 'runs' && id) return sendJson(response, 200, api.run(id))
            if (resource === 'gaps')
                return sendJson(
                    response,
                    200,
                    api.gaps({
                        ...(parameters.get('manufacturer') && { manufacturer: parameters.get('manufacturer')! }),
                        ...(parameters.get('line') && { line: parameters.get('line')! }),
                        ...(parameters.get('kind') && { kind: parameters.get('kind')! }),
                        ...(parameters.get('area') && { area: parameters.get('area')! }),
                        all: parameters.get('all') === 'true' || parameters.get('all') === 'yes',
                    })
                )
            if (resource === 'gaps.md') return send(response, 200, 'text/markdown; charset=utf-8', api.gapsMarkdown())
            if (resource === 'catalog') return sendJson(response, 200, api.catalog())
            if (resource === 'profiles')
                return sendJson(
                    response,
                    200,
                    api.profiles({
                        ...(parameters.get('manufacturer') && { manufacturer: parameters.get('manufacturer')! }),
                        ...(parameters.get('fidelity') && { fidelity: parameters.get('fidelity')! }),
                        ...(parameters.get('q') && { q: parameters.get('q')! }),
                        limit: parameters.get('limit'),
                        offset: parameters.get('offset'),
                    })
                )
            throw new ApiError(404, `No endpoint GET /api/v1/${route}`)
        }
        if (method !== 'POST' && method !== 'DELETE') throw new ApiError(405, `Method ${method} not allowed`)
        authorizeControl(request, token)
        if (method === 'DELETE' && resource === 'runs' && id === 'active')
            return sendJson(response, 200, api.cancelRun())
        if (method === 'POST' && resource === 'runs' && !id) {
            const body = await readJson(request)
            return sendJson(response, 202, api.startRun(body as Parameters<CompatApi['startRun']>[0]))
        }
        if (method === 'POST' && resource === 'ingest') {
            return sendJson(
                response,
                200,
                await api.ingest((await readJson(request)) as Parameters<CompatApi['ingest']>[0])
            )
        }
        if (method === 'POST' && resource === 'reports')
            return sendJson(response, 200, await api.regenerate(await readJson(request)))
        if (method === 'POST' && resource === 'import') {
            const text = await readBody(request, MAXIMUM_IMPORT_BYTES)
            return sendJson(response, 200, importFile(data, parameters.get('name') ?? 'results.json', text))
        }
        throw new ApiError(404, `No endpoint ${method} /api/v1/${route}`)
    }

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        let url: URL
        try {
            url = new URL(request.url ?? '/', 'http://localhost')
        } catch {
            return sendJson(response, 400, { message: 'Invalid request URL' })
        }
        try {
            if (url.pathname === '/assets/client.js')
                return send(response, 200, 'text/javascript; charset=utf-8', client)
            if (url.pathname === '/assets/compat-ui.css') return send(response, 200, 'text/css; charset=utf-8', styles)
            if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/'))
                return await handleApi(request, response, url)
            if (url.pathname.startsWith('/api/')) throw new ApiError(404, 'The API lives under /api/v1')
            if (request.method !== 'GET' && request.method !== 'HEAD') throw new ApiError(405, 'Method not allowed')
            const page = routePage(data, context, url.pathname, url.search)
            return send(response, page.status, 'text/html; charset=utf-8', page.html)
        } catch (error) {
            if (response.headersSent) return void response.end()
            if (error instanceof ApiError) return sendJson(response, error.status, { message: error.message })
            if (error instanceof URIError) return sendJson(response, 400, { message: 'The address is not valid' })
            return sendJson(response, 500, { message: error instanceof Error ? error.message : String(error) })
        }
    }
    const server = createServer((request, response) => void handle(request, response))
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 4174, options.host ?? '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    const host = address.family === 'IPv6' ? `[${address.address}]` : address.address
    return {
        url: `http://${host}:${address.port}/`,
        server,
        api,
        close: async () => {
            feed.stop()
            api.runner.stop()
            server.closeAllConnections?.()
            await new Promise<void>(resolve => server.close(() => resolve()))
        },
    }
}
