/// <reference lib="webworker" />
/**
 * Local neural text-to-speech via Kokoro (82M) — runs on WebGPU with a WASM
 * fallback, entirely on-device. The model (~90 MB) downloads once on first
 * use and is cached offline, same as Whisper.
 */
import { KokoroTTS } from 'kokoro-js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export interface TtsLoadMessage {
    type: 'load'
}
export interface TtsSpeakMessage {
    type: 'speak'
    id: number
    text: string
    voice: string
}
export type TtsInMessage = TtsLoadMessage | TtsSpeakMessage

export type TtsOutMessage =
    | { type: 'ready'; device: 'webgpu' | 'wasm' }
    | { type: 'load-error'; error: string }
    | { type: 'audio'; id: number; wav: ArrayBuffer }
    | { type: 'speak-error'; id: number; error: string }

interface KokoroInstance {
    generate(text: string, options: { voice: string }): Promise<{ toWav(): ArrayBuffer }>
}

let tts: KokoroInstance | null = null
let loading: Promise<void> | null = null

function post(message: TtsOutMessage, transfer?: Transferable[]): void {
    if (transfer) self.postMessage(message, transfer)
    else self.postMessage(message)
}

async function loadModel(): Promise<void> {
    if (tts) return
    if (loading) return loading

    loading = (async () => {
        let device: 'webgpu' | 'wasm' = 'webgpu'
        try {
            tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
                dtype: 'fp32',
                device: 'webgpu',
            })) as unknown as KokoroInstance
        } catch {
            device = 'wasm'
            tts = (await KokoroTTS.from_pretrained(MODEL_ID, {
                dtype: 'q8',
                device: 'wasm',
            })) as unknown as KokoroInstance
        }
        post({ type: 'ready', device })
    })()

    try {
        await loading
    } catch (error) {
        loading = null
        throw error
    }
}

self.onmessage = async (event: MessageEvent<TtsInMessage>) => {
    const message = event.data

    if (message.type === 'load') {
        try {
            await loadModel()
        } catch (error) {
            post({ type: 'load-error', error: error instanceof Error ? error.message : String(error) })
        }
        return
    }

    if (message.type === 'speak') {
        try {
            await loadModel()
            if (!tts) throw new Error('TTS model not loaded')
            const audio = await tts.generate(message.text, { voice: message.voice })
            const wav = audio.toWav()
            post({ type: 'audio', id: message.id, wav }, [wav])
        } catch (error) {
            post({ type: 'speak-error', id: message.id, error: error instanceof Error ? error.message : String(error) })
        }
    }
}
