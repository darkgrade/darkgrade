import { ModelCache, SPEECH_MODEL_FILES, SPEECH_MODEL_REVISIONS, totalModelBytes } from '@main/models/model-cache'
import { preferences } from '@main/preferences'
import { BarkSidecarProcess } from '@main/voice/bark-sidecar-process'
import { PythonRuntime } from '@main/voice/python-runtime'
import { IPC_EVENTS, type LogEntry, type VoiceEngineStatus } from '@shared/ipc'
import { speechModel, type SpeechModelId } from '@shared/speech-models'
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
    private status: VoiceEngineStatus = {
        phase: 'idle',
        receivedBytes: 0,
        totalBytes: 0,
        port: null,
        message: null,
        setupStep: null,
    }
    /** The model the running engine loaded, so a change of choice unloads it. */
    private loadedModel: SpeechModelId | null = null

    /** A release in progress, so a prepare that races it waits instead of returning the dying engine's port. */
    private releasing: Promise<void> | null = null

    constructor() {
        preferences.onChange(({ speechModel: chosen }) => {
            if (this.loadedModel && this.loadedModel !== chosen) void this.release()
            else this.setStatus({})
        })
    }

    private get chosenModel(): SpeechModelId {
        return preferences.get().speechModel
    }

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    getStatus(): VoiceEngineStatus {
        const files = SPEECH_MODEL_FILES[this.chosenModel]
        if (this.status.phase === 'idle' && !this.cache.isCached(files)) {
            return { ...this.status, totalBytes: totalModelBytes(files), phase: 'not-downloaded' }
        }
        return this.status
    }

    /** Downloads the model if needed and starts the engine; resolves with its local port. */
    async prepare(): Promise<number> {
        await this.releasing
        if (this.loadedModel && this.loadedModel !== this.chosenModel) await this.release()
        if (this.server?.port) return this.server.port
        this.preparing ??= this.startEngine().finally(() => {
            this.preparing = null
        })
        return this.preparing
    }

    /** Stops the engine to give its memory back; the model stays cached. */
    release(): Promise<void> {
        this.releasing ??= this.stopEngine().finally(() => {
            this.releasing = null
        })
        return this.releasing
    }

    private async stopEngine(): Promise<void> {
        await this.preparing?.catch(() => undefined)
        await this.server?.stop()
        this.server = null
        this.loadedModel = null
        this.setStatus({ phase: 'idle', port: null, message: null, setupStep: null })
    }

    private async startEngine(): Promise<number> {
        try {
            const model = this.chosenModel
            const files = SPEECH_MODEL_FILES[model]
            const server = new BarkSidecarProcess({
                modelDirectory: this.cache.modelDirectory(files),
                runner: speechModel(model).runner,
                environmentDirectory: join(app.getPath('userData'), 'bark-sidecar-environment'),
                pythonRuntime: new PythonRuntime({ directory: join(app.getPath('userData'), 'python-runtime') }),
                onSetupProgress: ({ step, receivedBytes, totalBytes }) =>
                    this.setStatus({
                        phase: step === 'python' ? 'downloading' : 'starting',
                        setupStep: step,
                        receivedBytes,
                        totalBytes,
                    }),
                onLog: line => this.writeEngineLog(line),
                onUnexpectedExit: description => {
                    this.server = null
                    this.log(`The speech engine stopped (${description})`, 'error')
                    this.setStatus({
                        phase: 'error',
                        port: null,
                        setupStep: null,
                        message: 'The speech engine stopped unexpectedly',
                    })
                },
            })
            await server.ensureEnvironment()
            await this.downloadModel(model)
            this.setStatus({ phase: 'starting', setupStep: 'loading', message: null })
            this.writeEngineLog(
                `[studio] loading ${speechModel(model).name} (revision ${SPEECH_MODEL_REVISIONS[model]})`
            )
            const port = await server.start()
            this.server = server
            this.loadedModel = model
            this.setStatus({ phase: 'ready', port, setupStep: null })
            this.log(`Speech engine ready (${speechModel(model).name})`)
            return port
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            this.log(message, 'error')
            this.setStatus({ phase: 'error', port: null, message, setupStep: null })
            throw error
        }
    }

    private async downloadModel(model: SpeechModelId): Promise<string[]> {
        const files = SPEECH_MODEL_FILES[model]
        if (!this.cache.isCached(files)) this.log(`Downloading ${speechModel(model).name} (one time)`)
        let lastReportMs = 0
        return this.cache.ensure(files, progress => {
            const now = Date.now()
            const done = progress.receivedBytes === progress.totalBytes
            if (!done && now - lastReportMs < PROGRESS_INTERVAL_MS) return
            lastReportMs = now
            this.setStatus({ phase: 'downloading', setupStep: 'speech-model', ...progress })
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
        this.broadcast(IPC_EVENTS.VoiceStatus, this.getStatus())
    }

    private log(message: string, level: LogEntry['level'] = 'info'): void {
        const entry: LogEntry = { timestampMs: Date.now(), source: 'voice', level, message }
        this.broadcast(IPC_EVENTS.Log, entry)
    }
}

export const voiceService = new VoiceService()
