import { findFreePort, isHealthy } from '@main/models/local-server'
import type { PythonDownloadProgress, PythonRuntime } from '@main/voice/python-runtime'
import { app } from 'electron'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

const HEALTH_POLL_INTERVAL_MS = 250
const STARTUP_TIMEOUT_MS = 180_000
const STOP_GRACE_MS = 3000

/** resources/vision-sidecar: the server script and its pinned requirements. The models are downloaded. */
export function visionSidecarDirectory(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'vision-sidecar')
}

export interface VisionEnvironmentOptions {
    /** Where the sidecar's Python environment is created and kept (one for both vision models). */
    directory: string
    pythonRuntime: Pick<PythonRuntime, 'ensure' | 'identity'>
    onSetupProgress: (progress: { step: 'python' | 'tools' } & PythonDownloadProgress) => void
    onLog: (line: string) => void
}

/** Creates the vision models' Python environment once, and again whenever its pinned requirements change. */
export async function ensureVisionEnvironment(options: VisionEnvironmentOptions): Promise<string> {
    const sidecar = visionSidecarDirectory()
    const pythonPath = join(options.directory, 'bin', 'python')
    const requirements = [join(sidecar, 'requirements.txt'), join(sidecar, 'requirements-without-dependencies.txt')]
    const hash = createHash('sha256').update(options.pythonRuntime.identity)
    for (const path of requirements) hash.update(readFileSync(path))
    const stamp = hash.digest('hex')
    const stampPath = join(options.directory, 'requirements.sha256')
    if (existsSync(pythonPath) && existsSync(stampPath) && readFileSync(stampPath, 'utf8') === stamp) return pythonPath

    options.onLog(`[studio] creating the vision environment in ${options.directory} (PyTorch, one time)`)
    const python = await options.pythonRuntime.ensure(progress =>
        options.onSetupProgress({ step: 'python', ...progress })
    )
    options.onSetupProgress({ step: 'tools', receivedBytes: 0, totalBytes: 0 })
    await runFile(python, ['-m', 'venv', '--clear', options.directory])
    const pip = join(options.directory, 'bin', 'pip')
    const install = (pipArguments: string[]) =>
        runFile(pip, ['install', '--quiet', ...pipArguments], { maxBuffer: 16 * 1024 * 1024 })
    await install(['--requirement', requirements[0]])
    await install(['--no-deps', '--requirement', requirements[1]])
    writeFileSync(stampPath, stamp)
    return pythonPath
}

export interface VisionSidecarOptions {
    pythonPath: string
    /** vision_server.py's arguments after the script: the model and its folders. */
    modelArguments: string[]
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** Runs one vision model's server on a private local port and stops it on request. */
export class VisionSidecarProcess {
    private child: ChildProcess | null = null
    private stopping = false
    port: number | null = null

    constructor(private readonly options: VisionSidecarOptions) {}

    async start(): Promise<number> {
        const port = await findFreePort()
        const options = this.options
        const script = join(visionSidecarDirectory(), 'vision_server.py')
        this.stopping = false
        const child = spawn(options.pythonPath, ['-I', script, ...options.modelArguments, '--port', String(port)], {
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        this.child = child
        this.port = port

        let lastOutput = ''
        const collect = (chunk: Buffer): void => {
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

        const deadline = Date.now() + STARTUP_TIMEOUT_MS
        while (Date.now() < deadline) {
            if (await isHealthy(port)) return port
            const result = await Promise.race([
                exited,
                new Promise<null>(resolve => setTimeout(() => resolve(null), HEALTH_POLL_INTERVAL_MS)),
            ])
            if (result !== null) throw new Error(`The vision engine didn't start (${result}): ${lastOutput}`)
        }
        await this.stop()
        throw new Error('The vision engine took too long to start')
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
