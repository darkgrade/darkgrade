import {
    DEPTH_PRO_2_FOCAL,
    depthPro2Model,
    ModelCache,
    SAM_3,
    totalModelBytes,
    type CachedModel,
} from '@main/models/model-cache'
import { preferences } from '@main/preferences'
import { ensureVisionEnvironment, VisionSidecarProcess } from '@main/vision/vision-sidecar-process'
import { PythonRuntime } from '@main/voice/python-runtime'
import { IPC_EVENTS, type LogEntry, type Preferences } from '@shared/ipc'
import {
    DEFAULT_SEGMENTATION_PROMPT,
    visionModel,
    type VisionEngineStatus,
    type VisionModelId,
    type VisionOverlay,
} from '@shared/vision-models'
import { app } from 'electron'
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { errorMessage } from '@shared/format'

type Broadcast = (channel: string, payload: unknown) => void

const PROGRESS_INTERVAL_MS = 150
const REQUEST_TIMEOUT_MS = 60_000

/** What a vision engine answers; `imagePng` is the depth map or the instances drawn over the picture. */
export interface VisionResult {
    imagePng: string
    [field: string]: unknown
}

/** The files and server arguments of a vision model, from the current preferences. */
function engineFiles(id: VisionModelId, current: Preferences): { models: CachedModel[]; key: string } {
    if (id === 'sam3') return { models: [SAM_3], key: 'sam3' }
    return {
        models: [depthPro2Model(current.depthModelSize), DEPTH_PRO_2_FOCAL],
        key: `depth-${current.depthModelSize}`,
    }
}

function isWanted(id: VisionModelId, current: Preferences): boolean {
    return current.developerMode && current.visionModels.includes(id)
}

/** One vision model's server: downloaded once, then kept loaded until it is turned off. */
class VisionEngine {
    private server: VisionSidecarProcess | null = null
    private preparing: Promise<number> | null = null
    private releasing: Promise<void> | null = null
    private loadedKey: string | null = null
    /** The model that last failed to start; it isn't retried on every settings change, only when asked for again. */
    failedKey: string | null = null
    status: VisionEngineStatus = { phase: 'off', receivedBytes: 0, totalBytes: 0, message: null }

    constructor(
        readonly id: VisionModelId,
        private readonly host: VisionService
    ) {}

    get loaded(): string | null {
        return this.loadedKey
    }

    async prepare(): Promise<number> {
        await this.releasing
        const { key } = engineFiles(this.id, preferences.get())
        if (this.loadedKey && this.loadedKey !== key) await this.release()
        if (this.server?.port) return this.server.port
        this.preparing ??= this.start().finally(() => {
            this.preparing = null
        })
        return this.preparing
    }

    release(): Promise<void> {
        this.releasing ??= (async () => {
            await this.preparing?.catch(() => undefined)
            await this.server?.stop()
            this.server = null
            this.loadedKey = null
            this.setStatus({ phase: 'off', message: null })
        })().finally(() => {
            this.releasing = null
        })
        return this.releasing
    }

    private async start(): Promise<number> {
        const name = visionModel(this.id).name
        const { models, key } = engineFiles(this.id, preferences.get())
        try {
            const pythonPath = await this.host.environment(this)
            const directories = await this.download(models)
            const modelArguments =
                this.id === 'sam3'
                    ? ['--model', 'sam3', '--path', directories[0]]
                    : ['--model', 'depth-pro-2', '--path', directories[0], '--focal-path', directories[1]]
            this.setStatus({ phase: 'starting', message: null })
            this.host.writeEngineLog(`[studio] loading ${name} (${key})`)
            const server = new VisionSidecarProcess({
                pythonPath,
                modelArguments,
                onLog: line => this.host.writeEngineLog(`[${this.id}] ${line}`),
                onUnexpectedExit: description => {
                    this.server = null
                    this.loadedKey = null
                    this.host.log(`${name} stopped (${description})`, 'error')
                    this.setStatus({ phase: 'error', message: `${name} stopped unexpectedly` })
                },
            })
            const port = await server.start()
            this.server = server
            this.loadedKey = key
            this.setStatus({ phase: 'ready', message: null })
            this.failedKey = null
            this.host.log(`${name} ready`)
            return port
        } catch (error) {
            const message = errorMessage(error)
            this.host.log(`${name}: ${message}`, 'error')
            this.failedKey = key
            this.setStatus({ phase: 'error', message })
            throw error
        }
    }

    private async download(models: CachedModel[]): Promise<string[]> {
        const cache = this.host.cache
        const totalBytes = models.reduce((sum, model) => sum + totalModelBytes(model), 0)
        if (models.some(model => !cache.isCached(model)))
            this.host.log(`Downloading ${visionModel(this.id).name} (one time)`)
        const received = new Map<string, number>()
        let lastReportMs = 0
        await Promise.all(
            models.map(model =>
                cache.ensure(model, progress => {
                    received.set(model.id, progress.receivedBytes)
                    const receivedBytes = [...received.values()].reduce((sum, bytes) => sum + bytes, 0)
                    const now = Date.now()
                    if (receivedBytes !== totalBytes && now - lastReportMs < PROGRESS_INTERVAL_MS) return
                    lastReportMs = now
                    this.setStatus({ phase: 'downloading', receivedBytes, totalBytes })
                })
            )
        )
        return models.map(model => cache.modelDirectory(model))
    }

    /** Sends a picture to the engine, starting it first if needed. */
    async request(route: string, query: Record<string, string>, image: Uint8Array): Promise<VisionResult> {
        const port = await this.prepare()
        const url = new URL(`http://127.0.0.1:${port}${route}`)
        for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value)
        const response = await fetch(url, {
            method: 'POST',
            body: Buffer.from(image),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        const body = (await response.json()) as VisionResult & { error?: string }
        if (!response.ok) throw new Error(body.error ?? `${visionModel(this.id).name} failed (HTTP ${response.status})`)
        return body
    }

    setStatus(change: Partial<VisionEngineStatus>): void {
        this.status = { ...this.status, ...change }
        this.host.broadcastStatus()
    }
}

/**
 * Developer Mode's vision models, Depth Pro 2 and SAM 3: each in its own process, independent of each other and of
 * the speech engine and the assistant, so all four can be loaded at once.
 */
class VisionService {
    readonly cache = new ModelCache(join(app.getPath('userData'), 'models'))
    private broadcast: Broadcast = () => {}
    private engineLog: WriteStream | null = null
    private environmentReady: Promise<string> | null = null
    private readonly engines: Record<VisionModelId, VisionEngine> = {
        'depth-pro-2': new VisionEngine('depth-pro-2', this),
        sam3: new VisionEngine('sam3', this),
    }

    constructor() {
        preferences.onChange(current => this.apply(current))
    }

    setBroadcast(broadcast: Broadcast): void {
        this.broadcast = broadcast
    }

    /** Loads the models turned on in Developer Mode, and lets go of the others. */
    apply(current: Preferences = preferences.get()): void {
        for (const engine of Object.values(this.engines)) {
            if (!isWanted(engine.id, current)) {
                engine.failedKey = null
                void engine.release()
                continue
            }
            const { key } = engineFiles(engine.id, current)
            if (engine.loaded === key && engine.status.phase === 'ready') continue
            if (engine.failedKey === key && engine.status.phase === 'error') continue
            void engine.prepare().catch(() => undefined)
        }
    }

    getStatus(): Record<VisionModelId, VisionEngineStatus> {
        return { 'depth-pro-2': this.engines['depth-pro-2'].status, sam3: this.engines.sam3.status }
    }

    /** Depth in metres for a JPEG or PNG; `focalLengthPixels` is in the picture's own pixels, when known. */
    estimateDepth(image: Uint8Array, focalLengthPixels?: number): Promise<VisionResult> {
        this.turnOn('depth-pro-2')
        const query: Record<string, string> = focalLengthPixels ? { focal_px: String(focalLengthPixels) } : {}
        return this.engines['depth-pro-2'].request('/v1/depth', query, image)
    }

    /** Every instance of `prompt` (a short noun phrase) in a JPEG or PNG. */
    segment(image: Uint8Array, prompt: string, threshold = 0.5): Promise<VisionResult> {
        this.turnOn('sam3')
        return this.engines.sam3.request('/v1/segment', { prompt, threshold: String(threshold) }, image)
    }

    /**
     * One live overlay for Developer Mode's scopes: Depth Pro 2's coloured depth map, or SAM 3's instances of `prompt`
     * as coloured masks with outlines on a transparent picture. Each model has its own process, so both run at once.
     */
    async overlay(id: VisionModelId, image: Uint8Array, prompt: string): Promise<VisionOverlay> {
        if (!preferences.get().developerMode) throw new Error('Vision overlays need Developer Mode')
        if (id === 'depth-pro-2') {
            const result = await this.estimateDepth(image)
            return {
                imagePng: result.imagePng,
                modelMilliseconds: Number(result.milliseconds),
                medianMetres: typeof result.medianMetres === 'number' ? result.medianMetres : null,
            }
        }
        if (id !== 'sam3') throw new Error(`No vision model called ${String(id)}`)
        this.turnOn('sam3')
        const query = { prompt: prompt.trim() || DEFAULT_SEGMENTATION_PROMPT, threshold: '0.5', overlay: '1' }
        const result = await this.engines.sam3.request('/v1/segment', query, image)
        return {
            imagePng: result.imagePng,
            modelMilliseconds: Number(result.milliseconds),
            instanceCount: Array.isArray(result.instances) ? result.instances.length : 0,
        }
    }

    /** Using a model turns it on in Developer Mode's menu, so it stays loaded. */
    private turnOn(id: VisionModelId): void {
        const current = preferences.get()
        if (!current.visionModels.includes(id)) preferences.set({ visionModels: [...current.visionModels, id] })
    }

    release(): Promise<void> {
        return Promise.all(Object.values(this.engines).map(engine => engine.release())).then(() => undefined)
    }

    /** The one Python environment both models share, created once even when both start together. */
    environment(engine: VisionEngine): Promise<string> {
        this.environmentReady ??= ensureVisionEnvironment({
            directory: join(app.getPath('userData'), 'vision-sidecar-environment'),
            pythonRuntime: new PythonRuntime({ directory: join(app.getPath('userData'), 'python-runtime') }),
            onSetupProgress: ({ receivedBytes, totalBytes }) =>
                engine.setStatus({ phase: 'starting', receivedBytes, totalBytes }),
            onLog: line => this.writeEngineLog(line),
        }).catch(error => {
            this.environmentReady = null
            throw error
        })
        return this.environmentReady
    }

    broadcastStatus(): void {
        this.broadcast(IPC_EVENTS.VisionStatus, this.getStatus())
    }

    writeEngineLog(line: string): void {
        if (!this.engineLog) {
            mkdirSync(app.getPath('logs'), { recursive: true })
            this.engineLog = createWriteStream(join(app.getPath('logs'), 'vision-engine.log'), { flags: 'a' })
        }
        this.engineLog.write(`${new Date().toISOString()} ${line}\n`)
    }

    log(message: string, level: LogEntry['level'] = 'info'): void {
        const entry: LogEntry = { timestampMs: Date.now(), source: 'vision', level, message }
        this.broadcast(IPC_EVENTS.Log, entry)
    }
}

export const visionService = new VisionService()
