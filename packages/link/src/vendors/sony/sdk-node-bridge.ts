import type { SonySdkBridge } from '@vendors/sony/sdk-camera'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export interface SonySdkBridgeOptions {
    executable: string
    workingDirectory?: string
    environment?: Record<string, string>
    timeoutMilliseconds?: number
    startupTimeoutMilliseconds?: number
}

/** Spawn an operator-installed official-SDK bridge; no SDK binaries are bundled. */
export async function createSonySdkBridge(options: SonySdkBridgeOptions): Promise<SonySdkBridge> {
    const bridge = new SonySdkNodeBridge(options)
    try {
        await bridge.ready()
        return bridge
    } catch (error) {
        await bridge.close()
        throw error
    }
}

class SonySdkNodeBridge implements SonySdkBridge {
    private readonly child: ChildProcessWithoutNullStreams
    private pending?: {
        resolve: (value: Record<string, unknown>) => void
        reject: (error: Error) => void
        timer: ReturnType<typeof setTimeout>
    }
    private queue: Promise<unknown> = Promise.resolve()
    private closed = false
    private readonly startup: Promise<Record<string, unknown>>
    private readonly timeoutMilliseconds: number

    constructor(options: SonySdkBridgeOptions) {
        this.timeoutMilliseconds = options.timeoutMilliseconds ?? 30_000
        if (
            !options.executable ||
            !Number.isInteger(this.timeoutMilliseconds) ||
            this.timeoutMilliseconds < 100 ||
            this.timeoutMilliseconds > 120_000
        )
            throw new Error('Invalid SDK bridge executable or deadline')
        const startupTimeout=options.startupTimeoutMilliseconds??this.timeoutMilliseconds
        if(!Number.isInteger(startupTimeout)||startupTimeout<100||startupTimeout>120000)throw new Error('Invalid SDK bridge startup deadline')
        this.child = spawn(options.executable, [], {
            cwd: options.workingDirectory,
            env: { ...process.env, ...options.environment },
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.startup = this.waitForReply(startupTimeout)
        this.child.stderr.resume()
        this.child.stdin.on('error', () => this.fail(new Error('Sony SDK bridge input closed')))
        this.child.on('error', () => this.fail(new Error('Sony SDK bridge could not start')))
        this.child.on('exit', () => this.fail(new Error('Sony SDK bridge exited')))
        const lines = createInterface({ input: this.child.stdout })
        lines.on('line', line => this.receiveLine(line))
    }

    async ready(): Promise<void> {
        await this.startup
    }

    private receiveLine(line: string): void {
        if (line.length > 2_000_000) {
            this.fail(new Error('Sony SDK bridge response is too large'))
            return
        }
        let result: Record<string, unknown>
        try {
            // Native uint64 property values need exact decimal strings before JSON parsing.
            result = JSON.parse(line.replace(/"value"\s*:\s*(-?\d+)/g, '"value":"$1"'))
        } catch {
            return
        }
        if (typeof result.ok !== 'boolean') return
        const pending = this.pending
        if (!pending) {
            this.fail(new Error('Unexpected Sony SDK bridge response'))
            return
        }
        this.pending = undefined
        clearTimeout(pending.timer)
        if (!result.ok) {
            // Only bounded numeric transfer diagnostics may leave the native
            // process. Its error text can include private paths or credentials.
            const transfer: string[] = []
            if (typeof result.transferPercent === 'number' && Number.isInteger(result.transferPercent) &&
                result.transferPercent >= 0 && result.transferPercent <= 100)
                transfer.push(`transfer ${result.transferPercent}%`)
            if (typeof result.transferStatus === 'number' && Number.isInteger(result.transferStatus) &&
                result.transferStatus >= 0 && result.transferStatus <= 0xffff_ffff)
                transfer.push(`status ${result.transferStatus}`)
            pending.reject(
                Object.assign(new Error(`Sony SDK command failed${Number.isInteger(result.code) ? ` (SDK code ${result.code})` : ''}${transfer.length ? ` (${transfer.join(', ')})` : ''}`),{retryableTransfer:result.retryableTransfer===true})
            )
            return
        }
        pending.resolve(result)
    }

    private waitForReply(timeoutMilliseconds = this.timeoutMilliseconds): Promise<Record<string, unknown>> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => this.fail(new Error('Sony SDK bridge response timed out')),
                timeoutMilliseconds
            )
            this.pending = { resolve, reject, timer }
        })
    }

    private fail(error: Error): void {
        Object.assign(error,{retryableTransfer:true})
        const pending = this.pending
        this.pending = undefined
        if (pending) {
            clearTimeout(pending.timer)
            pending.reject(error)
        }
        this.closed = true
        this.kill()
    }

    private kill(): void {
        this.child.kill('SIGKILL')
    }

    request(command: Record<string, string>): Promise<Record<string, unknown>> {
        const operation = this.queue.then(async () => {
            if (this.closed) throw new Error('Sony SDK bridge is closed')
            if (Object.values(command).some(value => typeof value !== 'string' || /[\r\n]/.test(value)))
                throw new Error('Invalid SDK bridge command')
            // Native media downloads have their own bounded nine-minute transfer
            // window. Leave room for their final reply without slowing other commands.
            const deadline = command.cmd === 'download_content' ? 550_000
                : command.cmd === 'disconnect' ? Math.min(12_000, this.timeoutMilliseconds) : this.timeoutMilliseconds
            const reply = this.waitForReply(deadline)
            this.child.stdin.write(JSON.stringify(command) + '\n')
            return await reply
        })
        this.queue = operation.catch(() => undefined)
        return operation
    }

    async close(): Promise<void> {
        if (this.closed) return
        this.fail(new Error('Sony SDK bridge closed'))
    }
}
