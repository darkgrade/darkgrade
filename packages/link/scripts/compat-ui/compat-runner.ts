/**
 * Starts the simulation suite (optionally filtered) as a child process, one run at a time, and can
 * cancel it. The suite writes its own progress log, which the UI, API and MCP server follow; this
 * class only owns the process. The command is injectable so tests can stand in a short process.
 */
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import path from 'node:path'

const KILL_GRACE_MILLISECONDS = 5_000
const MAXIMUM_FILTER_LENGTH = 2_000

/** Bun runs the TypeScript scripts; under Node (vitest) the `bun` on PATH does. */
export function bunExecutable(): string {
    return process.versions.bun ? process.execPath : 'bun'
}

export interface SuiteRunnerOptions {
    /** The command and arguments; the default runs the camera compatibility suite with vitest. */
    command?: string[]
    cwd?: string
    /** Where the child's output goes. */
    logFile: string
    /** Extra environment, e.g. COMPAT_RUNS_DIRECTORY so the run log lands where the UI reads. */
    environment?: Record<string, string>
}

export interface RunnerStatus {
    running: boolean
    pid?: number
    filter?: string
    startedAt?: string
    last?: { filter: string; startedAt: string; endedAt: string; exitCode: number | null; cancelled: boolean }
}

export class SuiteRunner {
    private child?: ChildProcess
    private current?: { filter: string; startedAt: string; cancelled: boolean }
    private last?: RunnerStatus['last']
    private killTimer?: ReturnType<typeof setTimeout>

    constructor(private readonly options: SuiteRunnerOptions) {}

    status(): RunnerStatus {
        return {
            running: !!this.child,
            ...(this.child?.pid && { pid: this.child.pid }),
            ...(this.current && { filter: this.current.filter, startedAt: this.current.startedAt }),
            ...(this.last && { last: this.last }),
        }
    }

    start(filter: string): { started: boolean; message: string; pid?: number } {
        if (this.child) return { started: false, message: 'A simulation run is already in progress.' }
        if (filter.length > MAXIMUM_FILTER_LENGTH) return { started: false, message: 'The filter is too long.' }
        mkdirSync(path.dirname(this.options.logFile), { recursive: true })
        const log = createWriteStream(this.options.logFile)
        const [command, ...argumentsList] = this.options.command ?? [
            bunExecutable(),
            'x',
            'vitest',
            'run',
            'tests/camera-simulation/camera-compatibility.test.ts',
        ]
        // Its own process group, so cancelling stops vitest's workers too.
        const child = spawn(command, argumentsList, {
            cwd: this.options.cwd ?? packageDirectory,
            env: { ...process.env, ...this.options.environment, ...(filter ? { COMPAT_ONLY: filter } : {}) },
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        })
        child.stdout?.pipe(log)
        child.stderr?.pipe(log)
        const startedAt = new Date().toISOString()
        this.current = { filter, startedAt, cancelled: false }
        const finish = (exitCode: number | null) => {
            if (this.child !== child) return
            clearTimeout(this.killTimer)
            this.last = {
                filter,
                startedAt,
                endedAt: new Date().toISOString(),
                exitCode,
                cancelled: !!this.current?.cancelled,
            }
            this.child = undefined
            this.current = undefined
        }
        child.on('exit', code => finish(code))
        child.on('error', error => {
            log.write(`\n${error.message}\n`)
            finish(null)
        })
        this.child = child
        return {
            started: true,
            message: filter ? `Started a simulation run for ${filter}` : 'Started a full simulation run',
            ...(child.pid && { pid: child.pid }),
        }
    }

    /** Stops the run this runner started; runs started elsewhere (another terminal, CI) are not touched. */
    cancel(): { cancelled: boolean; message: string } {
        const child = this.child
        if (!child) return { cancelled: false, message: 'No run started from here is in progress.' }
        if (this.current) this.current.cancelled = true
        this.signal(child, 'SIGTERM')
        this.killTimer = setTimeout(() => this.signal(child, 'SIGKILL'), KILL_GRACE_MILLISECONDS)
        this.killTimer.unref?.()
        return { cancelled: true, message: 'Cancelling the simulation run.' }
    }

    stop(): void {
        if (this.child) this.signal(this.child, 'SIGTERM')
    }

    private signal(child: ChildProcess, signal: NodeJS.Signals): void {
        if (!child.pid || child.exitCode !== null) return
        try {
            if (process.platform === 'win32') child.kill(signal)
            else process.kill(-child.pid, signal)
        } catch {
            child.kill(signal)
        }
    }
}
