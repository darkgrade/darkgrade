import { LlamaServerProcess, llamaServerBinary } from '@main/models/llama-server-process'
import { ModelCache, totalModelBytes, VOXTRAL_REALTIME } from '@main/models/model-cache'
import { IPC_EVENTS, type LogEntry, type VoiceEngineStatus } from '@shared/ipc'
import { app } from 'electron'
import { createWriteStream, mkdirSync, readdirSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'

type Broadcast = (channel: string, payload: unknown) => void

/** Tokens per session. Voxtral writes one token per 80 ms of audio, so this covers about 20 minutes. */
const CONTEXT_TOKENS = 16_384
const PROGRESS_INTERVAL_MS = 150
/** One 80 ms step of look-ahead, the shortest Voxtral supports; it stayed word-perfect in our tests. */
const DELAY_TOKENS = 1
const SAMPLE_RATE = 16_000
/** Recent sessions kept for replaying a bad transcript; older ones are deleted. */
const KEPT_SESSION_RECORDINGS = 5

/** A mono PCM16 WAV file around raw samples. */
function wavFile(pcm: Uint8Array): Buffer {
    const header = Buffer.alloc(44)
    header.write('RIFF', 0)
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVEfmt ', 8)
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20)
    header.writeUInt16LE(1, 22)
    header.writeUInt32LE(SAMPLE_RATE, 24)
    header.writeUInt32LE(SAMPLE_RATE * 2, 28)
    header.writeUInt16LE(2, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36)
    header.writeUInt32LE(pcm.length, 40)
    return Buffer.concat([header, Buffer.from(pcm)])
}

/** Downloads the speech model once, then runs it in a local llama-server while voice is in use. */
class VoiceService {
    private broadcast: Broadcast = () => {}
    private cache = new ModelCache(join(app.getPath('userData'), 'models'))
    private server: LlamaServerProcess | null = null
    private preparing: Promise<number> | null = null
    private engineLog: WriteStream | null = null
    private status: VoiceEngineStatus = { phase: 'idle', receivedBytes: 0, totalBytes: 0, port: null, message: null }

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    getStatus(): VoiceEngineStatus {
        const cached = this.cache.isCached(VOXTRAL_REALTIME)
        if (this.status.phase === 'idle' && !cached) {
            return { ...this.status, totalBytes: totalModelBytes(VOXTRAL_REALTIME), phase: 'not-downloaded' }
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
            const [modelPath, projectorPath] = await this.downloadModel()
            this.setStatus({ phase: 'starting', message: null })
            const server = new LlamaServerProcess({
                binaryPath: llamaServerBinary(),
                modelPath,
                projectorPath,
                contextTokens: CONTEXT_TOKENS,
                parallel: 1,
                extraArguments: [
                    ['--override-kv', `mistral3.realtime_delay_tokens=int:${DELAY_TOKENS}`],
                    // Transcription wants the most likely word, every time; the default 0.8 invents variations.
                    ['--temp', '0'],
                ].flat(),
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
        if (!this.cache.isCached(VOXTRAL_REALTIME)) this.log('Downloading the speech model (one time)')
        let lastReportMs = 0
        return this.cache.ensure(VOXTRAL_REALTIME, progress => {
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
