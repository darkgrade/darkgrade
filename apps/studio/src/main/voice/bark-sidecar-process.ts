import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'

const runFile = promisify(execFile)

/**
 * Bark ships only Python code, so it runs in a Python sidecar (an approved exception to Studio's
 * TypeScript-only rule). These Pythons are tried in order; the first that exists builds the environment.
 */
const PYTHON_CANDIDATES = ['/opt/homebrew/bin/python3.11', '/usr/local/bin/python3.11', 'python3.11']
const HEALTH_POLL_INTERVAL_MS = 250
/** The first start unpacks model.bark into an MLX folder, which takes about a minute. */
const STARTUP_TIMEOUT_MS = 300_000
const STOP_GRACE_MS = 3000

export interface BarkSidecarOptions {
    /** Folder holding model.bark and mlx/ (see BARK_PLUS in model-cache). */
    modelDirectory: string
    /** Where the sidecar's Python environment is created and kept. */
    environmentDirectory: string
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** resources/bark-sidecar: the server script and its pinned requirements. The model and its code are downloaded. */
export function barkSidecarDirectory(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'bark-sidecar')
}

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

async function findPython(): Promise<string> {
    for (const candidate of PYTHON_CANDIDATES) {
        try {
            await runFile(candidate, ['--version'])
            return candidate
        } catch {
            continue
        }
    }
    throw new Error('Voice needs Python 3.11 (brew install python@3.11)')
}

/** Runs the Bark transcription server on a private local port and stops it on request. */
export class BarkSidecarProcess {
    private child: ChildProcess | null = null
    private stopping = false
    port: number | null = null

    constructor(private readonly options: BarkSidecarOptions) {}

    /** Creates the Python environment once, and again whenever the pinned requirements change. */
    async ensureEnvironment(): Promise<string> {
        const directory = this.options.environmentDirectory
        const requirementsPath = join(barkSidecarDirectory(), 'requirements.txt')
        const packagesWithoutDependenciesPath = join(barkSidecarDirectory(), 'requirements-without-dependencies.txt')
        const requirementsHash = createHash('sha256')
            .update(readFileSync(requirementsPath))
            .update(readFileSync(packagesWithoutDependenciesPath))
            .digest('hex')
        const stampPath = join(directory, 'requirements.sha256')
        const pythonPath = join(directory, 'bin', 'python')
        if (existsSync(pythonPath) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === requirementsHash) {
            return pythonPath
        }
        this.options.onLog(`[studio] creating the speech environment in ${directory}`)
        await runFile(await findPython(), ['-m', 'venv', '--clear', directory])
        await runFile(join(directory, 'bin', 'pip'), ['install', '--quiet', '--requirement', requirementsPath], {
            maxBuffer: 16 * 1024 * 1024,
        })
        await runFile(
            join(directory, 'bin', 'pip'),
            ['install', '--quiet', '--no-deps', '--requirement', packagesWithoutDependenciesPath],
            { maxBuffer: 16 * 1024 * 1024 }
        )
        writeFileSync(stampPath, requirementsHash)
        return pythonPath
    }

    async start(): Promise<number> {
        const pythonPath = await this.ensureEnvironment()
        const port = await findFreePort()
        const options = this.options
        const script = join(barkSidecarDirectory(), 'transcription_server.py')
        this.stopping = false
        const child = spawn(pythonPath, ['-I', script, '--path', options.modelDirectory, '--port', String(port)], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
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
                exited,
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
