import type { SpeechModelChoice } from '@shared/speech-models'
import { app } from 'electron'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { promisify } from 'node:util'

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
    /** The chosen model's download (see SPEECH_MODEL_FILES in model-cache). */
    modelDirectory: string
    runner: SpeechModelChoice['runner']
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

function requirementsStamp(paths: string[]): string {
    const hash = createHash('sha256')
    for (const path of paths) hash.update(readFileSync(path))
    return hash.digest('hex')
}

function readStamp(directory: string, name: string): string | null {
    const path = join(directory, name)
    return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** Runs the Bark transcription server on a private local port and stops it on request. */
export class BarkSidecarProcess {
    private child: ChildProcess | null = null
    private stopping = false
    port: number | null = null

    constructor(private readonly options: BarkSidecarOptions) {}

    /**
     * Creates the Python environment once, and again whenever the pinned requirements change. Bark 3.0
     * Pro's PyTorch and transformers are added the first time Pro is chosen.
     */
    async ensureEnvironment(): Promise<string> {
        const directory = this.options.environmentDirectory
        const sidecar = barkSidecarDirectory()
        const pythonPath = join(directory, 'bin', 'python')
        const baseStamp = requirementsStamp([
            join(sidecar, 'requirements.txt'),
            join(sidecar, 'requirements-without-dependencies.txt'),
        ])
        if (!existsSync(pythonPath) || readStamp(directory, 'requirements.sha256') !== baseStamp) {
            this.options.onLog(`[studio] creating the speech environment in ${directory}`)
            await runFile(await findPython(), ['-m', 'venv', '--clear', directory])
            await this.pipInstall(['--requirement', join(sidecar, 'requirements.txt')])
            await this.pipInstall([
                '--no-deps',
                '--requirement',
                join(sidecar, 'requirements-without-dependencies.txt'),
            ])
            writeFileSync(join(directory, 'requirements.sha256'), baseStamp)
        }
        if (this.options.runner !== 'transformers') return pythonPath
        const transformersRequirements = join(sidecar, 'requirements-transformers.txt')
        const transformersStamp = requirementsStamp([transformersRequirements])
        if (readStamp(directory, 'requirements-transformers.sha256') !== transformersStamp) {
            this.options.onLog('[studio] adding PyTorch and transformers for Bark 3.0 Pro (one time)')
            await this.pipInstall(['--requirement', transformersRequirements])
            writeFileSync(join(directory, 'requirements-transformers.sha256'), transformersStamp)
        }
        return pythonPath
    }

    private async pipInstall(pipArguments: string[]): Promise<void> {
        const pip = join(this.options.environmentDirectory, 'bin', 'pip')
        await runFile(pip, ['install', '--quiet', ...pipArguments], { maxBuffer: 16 * 1024 * 1024 })
    }

    async start(): Promise<number> {
        const pythonPath = await this.ensureEnvironment()
        const port = await findFreePort()
        const options = this.options
        const script = join(barkSidecarDirectory(), 'transcription_server.py')
        this.stopping = false
        const child = spawn(
            pythonPath,
            ['-I', script, '--runner', options.runner, '--path', options.modelDirectory, '--port', String(port)],
            {
                stdio: ['ignore', 'pipe', 'pipe'],
            }
        )
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
