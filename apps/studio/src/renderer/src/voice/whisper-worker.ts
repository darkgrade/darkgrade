/// <reference lib="webworker" />
/**
 * Runs Whisper fully on-device via transformers.js (ONNX Runtime).
 * Tries WebGPU first, falls back to WASM where the model allows it. Model
 * files are fetched once on first use and cached by the browser Cache API in
 * Electron's userData, so every later launch works offline.
 */
import { pipeline } from '@huggingface/transformers'
import type { AsrModelKey } from '@voice/asr-models'
import { ASR_MODELS } from '@voice/asr-models'

export interface WorkerLoadMessage {
    type: 'load'
    model: AsrModelKey
}
export interface WorkerTranscribeMessage {
    type: 'transcribe'
    id: number
    audio: Float32Array
}
export type WorkerInMessage = WorkerLoadMessage | WorkerTranscribeMessage

export type WorkerOutMessage =
    | { type: 'progress'; file: string; progress: number; status: string }
    | { type: 'ready'; device: 'webgpu' | 'wasm'; model: AsrModelKey }
    | { type: 'load-error'; error: string }
    | { type: 'result'; id: number; text: string; durationMs: number }
    | { type: 'transcribe-error'; id: number; error: string }

type AsrPipeline = (
    audio: Float32Array,
    options?: Record<string, unknown>
) => Promise<{ text: string } | Array<{ text: string }>>

let asr: AsrPipeline | null = null
let activeModel: AsrModelKey | null = null
let loading: Promise<void> | null = null

function post(message: WorkerOutMessage): void {
    self.postMessage(message)
}

function progressCallback(update: unknown): void {
    const info = update as { status?: string; file?: string; progress?: number }
    if (info.status === 'progress' || info.status === 'download' || info.status === 'done') {
        post({
            type: 'progress',
            file: info.file ?? '',
            progress: typeof info.progress === 'number' ? info.progress : 0,
            status: info.status ?? '',
        })
    }
}

async function loadModel(model: AsrModelKey): Promise<void> {
    if (asr && activeModel === model) return
    if (loading) return loading

    const config = ASR_MODELS[model]
    loading = (async () => {
        asr = null
        let device: 'webgpu' | 'wasm' = 'webgpu'
        try {
            asr = (await pipeline('automatic-speech-recognition', config.id, {
                device: 'webgpu',
                ...(config.webgpuDtype ? { dtype: config.webgpuDtype as never } : {}),
                progress_callback: progressCallback,
            })) as unknown as AsrPipeline
        } catch (webgpuError) {
            if (!config.wasmAllowed) throw webgpuError
            device = 'wasm'
            asr = (await pipeline('automatic-speech-recognition', config.id, {
                device: 'wasm',
                ...(config.wasmDtype ? { dtype: config.wasmDtype as never } : {}),
                progress_callback: progressCallback,
            })) as unknown as AsrPipeline
        }
        activeModel = model
        post({ type: 'ready', device, model })
    })()

    try {
        await loading
    } finally {
        loading = null
    }
}

self.onmessage = async (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data

    if (message.type === 'load') {
        try {
            await loadModel(message.model)
        } catch (error) {
            post({ type: 'load-error', error: error instanceof Error ? error.message : String(error) })
        }
        return
    }

    if (message.type === 'transcribe') {
        try {
            if (!asr || !activeModel) throw new Error('Model not loaded')
            const config = ASR_MODELS[activeModel]
            const startedAt = performance.now()
            const options = config.multilingual ? { language: 'en', task: 'transcribe' } : undefined
            const output = await asr(message.audio, options)
            const text = (Array.isArray(output) ? output.map(part => part.text).join(' ') : output.text) ?? ''
            post({
                type: 'result',
                id: message.id,
                text: text.trim(),
                durationMs: Math.round(performance.now() - startedAt),
            })
        } catch (error) {
            post({
                type: 'transcribe-error',
                id: message.id,
                error: error instanceof Error ? error.message : String(error),
            })
        }
    }
}
