import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'

/** A port nothing on this Mac is listening on, for a model server to take. */
export function findFreePort(): Promise<number> {
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

/** Whether the model server on `port` answers its health check (it does once its model is loaded). */
export async function isHealthy(port: number): Promise<boolean> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}/health`)
        return response.ok
    } catch {
        return false
    }
}

export interface LocalServerOptions {
    /** What a failure calls it: "model server", "speech engine", "vision engine". */
    name: string
    command: string
    /** Its arguments, given the private port it is to listen on. */
    args: (port: number) => string[]
    /** How long loading its model may take before /health answers. */
    startupTimeoutMs: number
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

const HEALTH_POLL_INTERVAL_MS = 250
const STOP_GRACE_MS = 3000

/**
 * One local model server (llama.cpp, the speech or the vision sidecar) on a private port: started,
 * ready once its /health answers, and stopped on request (SIGTERM, then SIGKILL after a grace).
 */
export class LocalServerProcess {
    private child: ChildProcess | null = null
    private stopping = false
    port: number | null = null

    constructor(private readonly options: LocalServerOptions) {}

    async start(): Promise<number> {
        const port = await findFreePort()
        const options = this.options
        this.stopping = false
        const child = spawn(options.command, options.args(port), { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child = child
        this.port = port

        let lastOutput = ''
        const collect = (chunk: Buffer): void => {
            // Progress bars rewrite their line with \r: each state is a line of its own.
            for (const line of chunk.toString().split(/[\n\r]/)) {
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

        const deadline = Date.now() + options.startupTimeoutMs
        while (Date.now() < deadline) {
            if (await isHealthy(port)) return port
            const result = await Promise.race([
                exited,
                new Promise<null>(resolve => setTimeout(() => resolve(null), HEALTH_POLL_INTERVAL_MS)),
            ])
            if (result !== null) throw new Error(`The ${options.name} didn't start (${result}): ${lastOutput}`)
        }
        await this.stop()
        throw new Error(`The ${options.name} took too long to start`)
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
