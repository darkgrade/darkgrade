import { BarkSidecarProcess } from '@main/voice/bark-sidecar-process'
import { BARK_PLUS, ModelCache, totalModelBytes } from '@main/models/model-cache'
import { IPC_EVENTS, type LogEntry, type VoiceEngineStatus } from '@shared/ipc'
import { wavFile } from '@shared/wav'
import { app } from 'electron'
import { createWriteStream, mkdirSync, readdirSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

type Broadcast = (channel: string, payload: unknown) => void

const PROGRESS_INTERVAL_MS = 150
/** Recent sessions kept for replaying a bad transcript; older ones are deleted. */
const KEPT_SESSION_RECORDINGS = 5

/** Downloads the speech model once, then runs it in the Bark sidecar while voice is in use. */
class VoiceService {
    private broadcast: Broadcast = () => {}
    private cache = new ModelCache(join(app.getPath('userData'), 'models'))
    private server: BarkSidecarProcess | null = null
    private preparing: Promise<number> | null = null
    private engineLog: WriteStream | null = null
    private status: VoiceEngineStatus = { phase: 'idle', receivedBytes: 0, totalBytes: 0, port: null, message: null }

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    getStatus(): VoiceEngineStatus {
        const cached = this.cache.isCached(BARK_PLUS)
        if (this.status.phase === 'idle' && !cached) {
            return { ...this.status, totalBytes: totalModelBytes(BARK_PLUS), phase: 'not-downloaded' }
        }
        return this.status
    }

    /** Downloads the model if needed and starts the engine; resolves with its local port. */
    prepare(): Promise<number> {
        if (this.server?.port) return Promise.resolve(this.server.port)
        this.preparing ??= this.startEngine().finally(() => {
            this.preparing = null
        })
        return this.preparing
    }

    /** Stops the engine to give its memory back; the model stays cached. */
    async release(): Promise<void> {
        await this.server?.stop()
        this.server = null
        this.setStatus({ phase: 'idle', port: null, message: null })
    }

    private async startEngine(): Promise<number> {
        try {
            await this.downloadModel()
            this.setStatus({ phase: 'starting', message: null })
            const server = new BarkSidecarProcess({
                modelDirectory: this.cache.modelDirectory(BARK_PLUS),
                environmentDirectory: join(app.getPath('userData'), 'bark-sidecar-environment'),
                onLog: line => this.writeEngineLog(line),
                onUnexpectedExit: description => {
                    this.server = null
                    this.log(`The speech engine stopped (${description})`, 'error')
                    this.setStatus({ phase: 'error', port: null, message: 'The speech engine stopped unexpectedly' })
                },
            })
            const port = await server.start()
            this.server = server
            this.setStatus({ phase: 'ready', port })
            this.log('Speech engine ready')
            return port
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.log(message, 'error')
            this.setStatus({ phase: 'error', port: null, message })
            throw error
        }
    }

    private async downloadModel(): Promise<string[]> {
        if (!this.cache.isCached(BARK_PLUS)) this.log('Downloading the speech model (one time)')
        let lastReportMs = 0
        return this.cache.ensure(BARK_PLUS, progress => {
            const now = Date.now()
            const done = progress.receivedBytes === progress.totalBytes
            if (!done && now - lastReportMs < PROGRESS_INTERVAL_MS) return
            lastReportMs = now
            this.setStatus({ phase: 'downloading', ...progress })
        })
    }

    /** Keeps the last session's audio, exactly as the engine heard it, for replaying a bad transcript. */
    saveSessionAudio(pcm: Uint8Array): string {
        const directory = join(app.getPath('userData'), 'voice-sessions')
        mkdirSync(directory, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const path = join(directory, `session-${stamp}.wav`)
        writeFileSync(path, wavFile(pcm))
        this.writeEngineLog(`[studio] saved session audio ${path}`)
        for (const old of readdirSync(directory).sort().slice(0, -KEPT_SESSION_RECORDINGS)) {
            rmSync(join(directory, old), { force: true })
        }
        return path
    }

    writeEngineLog(line: string): void {
        if (!this.engineLog) {
            mkdirSync(app.getPath('logs'), { recursive: true })
            this.engineLog = createWriteStream(join(app.getPath('logs'), 'voice-engine.log'), { flags: 'a' })
        }
        this.engineLog.write(`${new Date().toISOString()} ${line}\n`)
    }

    private setStatus(change: Partial<VoiceEngineStatus>): void {
        this.status = { ...this.status, ...change }
        this.broadcast(IPC_EVENTS.VoiceStatus, this.status)
    }

    private log(message: string, level: LogEntry['level'] = 'info'): void {
        const entry: LogEntry = { timestampMs: Date.now(), source: 'voice', level, message }
        this.broadcast(IPC_EVENTS.Log, entry)
    }
}

export const voiceService = new VoiceService()
