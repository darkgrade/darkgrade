/**
 * The local compatibility UI server: renders the pages, streams run progress over server-sent events,
 * starts filtered simulation runs and imports result files. Bound to 127.0.0.1 unless told otherwise.
 */
import { packageDirectory, parseProgress } from '@scripts/camera-profiles/compat-progress'
import type { SupportMatrix } from '@scripts/camera-profiles/support-matrix'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { buildClientBundle, stylesheet } from './compat-assets'
import { CompatData } from './compat-data'
import type { PageContext } from './compat-pages'
import { routePage } from './compat-site'
import type { CompatView } from './compat-view'

const TICK_MILLISECONDS = 700
const MAXIMUM_IMPORT_BYTES = 64 * 1024 * 1024

export interface CompatServerOptions {
    host?: string
    port?: number
    data?: CompatData
}

export interface RunningServer {
    url: string
    server: Server
    close: () => Promise<void>
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
    response.end(body)
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
    send(response, status, 'application/json; charset=utf-8', JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
        size += (chunk as Buffer).length
        if (size > MAXIMUM_IMPORT_BYTES) throw new Error('Upload is larger than 64 MB')
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
}

/** Watches result files and pushes changed rows and run progress to every open page. */
class LiveFeed {
    private clients = new Set<ServerResponse>()
    private timer?: ReturnType<typeof setInterval>
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
        // The diff baseline is shared by all pages; only the first page sets it, so pages that are
        // already open never miss a change. A new page subscribes before it fetches the view.
        const view = this.data.view()
        if (!this.timer) this.remember(view)
        this.write(response, 'progress', view.activeRun ?? null)
        this.clients.add(response)
        response.on('close', () => {
            this.clients.delete(response)
            if (this.clients.size === 0) this.stop()
        })
        this.timer ??= setInterval(() => this.tick(), TICK_MILLISECONDS)
    }

    stop(): void {
        clearInterval(this.timer)
        this.timer = undefined
        for (const client of this.clients) client.end()
        this.clients.clear()
    }

    private write(response: ServerResponse, event: string, value: unknown): void {
        response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
    }

    private broadcast(event: string, value: unknown): void {
        for (const client of this.clients) this.write(client, event, value)
    }

    private currentSignature(): string {
        const files = [
            ...this.data.runFiles().map(run => `${run.file}:${run.size}:${run.modified}`),
            ...this.data.matrixFiles().map(matrix => `${matrix.file}:${statSync(matrix.file).mtimeMs}`),
        ]
        return files.join('|')
    }

    private remember(view: CompatView): void {
        this.signature = this.currentSignature()
        this.rows = new Map(view.rows.map(row => [row.key, JSON.stringify(row)]))
        this.activeRunId = view.activeRun?.runId
    }

    private tick(): void {
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
    }
}

/** Runs the simulation suite (optionally filtered) in the background, one run at a time. */
class SuiteRunner {
    private child?: ChildProcess

    constructor(private readonly logDirectory: string) {}

    start(filter: string): { started: boolean; message: string } {
        if (this.child) return { started: false, message: 'A simulation run is already in progress.' }
        mkdirSync(this.logDirectory, { recursive: true })
        const log = createWriteStream(path.join(this.logDirectory, 'compat-ui-run.log'))
        const child = spawn(
            process.execPath,
            ['x', 'vitest', 'run', 'tests/camera-simulation/camera-compatibility.test.ts'],
            {
                cwd: packageDirectory,
                env: { ...process.env, ...(filter ? { COMPAT_ONLY: filter } : {}) },
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        )
        child.stdout?.pipe(log)
        child.stderr?.pipe(log)
        child.on('exit', () => {
            this.child = undefined
        })
        this.child = child
        return {
            started: true,
            message: filter ? `Started a simulation run for ${filter}` : 'Started a full simulation run',
        }
    }

    stop(): void {
        this.child?.kill()
    }
}

function importFile(data: CompatData, name: string, text: string): { status: number; message: string; open?: string } {
    const safeName = path.basename(name).replace(/[^A-Za-z0-9._-]/g, '_')
    if (safeName.endsWith('.jsonl')) {
        const start = parseProgress(text).find(event => event.type === 'run-start')
        if (!start) return { status: 400, message: `${safeName} is not a compatibility run log` }
        mkdirSync(data.runsDirectory, { recursive: true })
        writeFileSync(path.join(data.runsDirectory, `${start.runId}.jsonl`), text)
        return { status: 200, message: `Loaded run ${start.runId}`, open: `/?run=${encodeURIComponent(start.runId)}` }
    }
    let matrix: SupportMatrix
    try {
        matrix = JSON.parse(text) as SupportMatrix
    } catch {
        return { status: 400, message: `${safeName} is not JSON` }
    }
    if (!Array.isArray(matrix.rows) || !Array.isArray(matrix.capabilities)) {
        return { status: 400, message: `${safeName} is not a support matrix` }
    }
    mkdirSync(data.importsDirectory, { recursive: true })
    const file = path.join(data.importsDirectory, safeName.endsWith('.json') ? safeName : `${safeName}.json`)
    writeFileSync(file, text)
    const id = `matrix:${path.relative(data.resultsDirectory, file)}`
    return {
        status: 200,
        message: `Loaded ${matrix.rows.length} rows from ${safeName}`,
        open: `/?run=${encodeURIComponent(id)}`,
    }
}

export async function startCompatServer(options: CompatServerOptions = {}): Promise<RunningServer> {
    const data = options.data ?? new CompatData()
    const context: PageContext = { base: '/', live: true }
    const client = await buildClientBundle()
    const styles = stylesheet()
    const feed = new LiveFeed(data)
    const runner = new SuiteRunner(data.resultsDirectory)

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        try {
            if (url.pathname === '/assets/client.js')
                return send(response, 200, 'text/javascript; charset=utf-8', client)
            if (url.pathname === '/assets/compat-ui.css') return send(response, 200, 'text/css; charset=utf-8', styles)
            if (url.pathname === '/api/view') {
                const run = url.searchParams.get('run')
                const view = run ? data.singleView(run) : data.view()
                return view ? sendJson(response, 200, view) : sendJson(response, 404, { message: `No run ${run}` })
            }
            if (url.pathname === '/api/events') return feed.add(response)
            if (url.pathname === '/api/run' && request.method === 'POST') {
                const { filter } = JSON.parse((await readBody(request)) || '{}') as { filter?: string }
                const result = runner.start((filter ?? '').trim())
                return sendJson(response, result.started ? 202 : 409, result)
            }
            if (url.pathname === '/api/import' && request.method === 'POST') {
                const result = importFile(data, url.searchParams.get('name') ?? 'results.json', await readBody(request))
                return sendJson(response, result.status, result)
            }
            if (request.method !== 'GET') return sendJson(response, 405, { message: 'Method not allowed' })
            const page = routePage(data, context, url.pathname, url.search)
            return send(response, page.status, 'text/html; charset=utf-8', page.html)
        } catch (error) {
            return sendJson(response, 500, { message: error instanceof Error ? error.message : String(error) })
        }
    }
    const server = createServer((request, response) => void handle(request, response))
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(options.port ?? 4174, options.host ?? '127.0.0.1', resolve)
    })
    const address = server.address() as AddressInfo
    return {
        url: `http://${address.address}:${address.port}/`,
        server,
        close: async () => {
            feed.stop()
            runner.stop()
            await new Promise<void>(resolve => server.close(() => resolve()))
        },
    }
}
