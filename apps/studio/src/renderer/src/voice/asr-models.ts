/**
 * Speech-recognition model catalog. Lightweight on purpose: imported by both
 * the whisper worker and the UI, so it must not pull in transformers.js.
 */

export type AsrModelKey = 'base.en' | 'small.en' | 'turbo'

export interface AsrModelConfig {
    id: string
    label: string
    /** Multilingual checkpoints need language pinned at generate time. */
    multilingual: boolean
    /** Heavy models are WebGPU-only; running them on WASM would take minutes. */
    wasmAllowed: boolean
    webgpuDtype?: Record<string, string> | string
    wasmDtype?: string
}

export const ASR_MODELS: Record<AsrModelKey, AsrModelConfig> = {
    'base.en': {
        id: 'Xenova/whisper-base.en',
        label: 'Fast — Whisper base (~80 MB)',
        multilingual: false,
        wasmAllowed: true,
        wasmDtype: 'q8',
    },
    'small.en': {
        id: 'Xenova/whisper-small.en',
        label: 'Accurate — Whisper small (~250 MB)',
        multilingual: false,
        wasmAllowed: true,
        wasmDtype: 'q8',
    },
    turbo: {
        id: 'onnx-community/whisper-large-v3-turbo',
        label: 'Best — Whisper large turbo (~1.2 GB, GPU only)',
        multilingual: true,
        wasmAllowed: false,
        webgpuDtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    },
}

export const DEFAULT_ASR_MODEL: AsrModelKey = 'small.en'
export const ASR_MODEL_STORAGE_KEY = 'studio.asrModel'

export function isAsrModelKey(value: string | null): value is AsrModelKey {
    return value !== null && value in ASR_MODELS
}
