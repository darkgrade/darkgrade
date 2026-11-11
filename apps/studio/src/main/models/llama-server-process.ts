import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'

export interface LlamaServerOptions {
    binaryPath: string
    modelPath: string
    projectorPath: string
    /** Prompt context per slot. */
    contextTokens: number
    /** Requests served at once. */
    parallel: number
    /** Model-specific options, e.g. sampling or metadata overrides. */
    extraArguments: string[]
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** The bundled llama.cpp server (fetched by scripts/download-llama-server.ts). */
export function llamaServerBinary(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'llama-server', 'llama-server')
}

const HEALTH_POLL_INTERVAL_MS = 250
const STARTUP_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 3000

function findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer()
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            const port = typeof address === 'object' && address ? address.port : 0
            server.close(() => resolve(port))
        })
    })
}

async function isHealthy(port: number): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`)
        return response.ok
    } catch {
        return false
    }
}

/** Runs one llama-server on a private local port and stops it on request. */
export class LlamaServerProcess {
    private child: ChildProcess | null = null
    private stopping = false
    port: number | null = null

    constructor(private readonly options: LlamaServerOptions) {}

    get running(): boolean {
        return this.child !== null
    }

    async start(): Promise<number> {
        const port = await findFreePort()
        const options = this.options
        const args = [
            ['--model', options.modelPath],
            ['--mmproj', options.projectorPath],
            ['--host', '127.0.0.1'],
            ['--port', String(port)],
            ['--n-gpu-layers', '99'],
            ['--parallel', String(options.parallel)],
            ['--ctx-size', String(options.contextTokens * options.parallel)],
            ['--no-webui'],
            options.extraArguments,
        ].flat()
        this.stopping = false
        const child = spawn(options.binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child = child
        this.port = port

        let lastOutput = ''
        const collect = (chunk: Buffer): void => {
            for (const line of chunk.toString().split('\n')) {
                if (!line.trim()) continue
                lastOutput = line.trim()
                options.onLog(lastOutput)
            }
        }
        child.stdout?.on('data', collect)
        child.stderr?.on('data', collect)

        const exited = new Promise<string>(resolve => {
            child.once('exit', (code, signal) => {
                this.child = null
                this.port = null
                const description = signal ? `stopped by ${signal}` : `exited with code ${code}`
                if (!this.stopping) options.onUnexpectedExit(`${description}: ${lastOutput}`)
                resolve(description)
            })
            child.once('error', error => resolve(error.message))
        })

        const deadline = Date.now() + STARTUP_TIMEOUT_MS
        while (Date.now() < deadline) {
            if (await isHealthy(port)) return port
            const result = await Promise.race([
                exited.then(description => description),
                new Promise<null>(resolve => setTimeout(() => resolve(null), HEALTH_POLL_INTERVAL_MS)),
            ])
            if (result !== null) throw new Error(`The speech engine didn't start (${result}): ${lastOutput}`)
        }
        await this.stop()
        throw new Error('The speech engine took too long to start')
    }

    async stop(): Promise<void> {
        const child = this.child
        if (!child) return
        this.stopping = true
        const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
        child.kill('SIGTERM')
        const forced = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS)
        await exited
        clearTimeout(forced)
    }
}
