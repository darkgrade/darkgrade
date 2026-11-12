import * as onnxRuntime from 'onnxruntime-web/wasm'
import runtimeModuleUrl from '@onnxruntime-web-distribution/ort-wasm-simd-threaded.mjs?url'
import runtimeBinaryUrl from '@onnxruntime-web-distribution/ort-wasm-simd-threaded.wasm?url'
import sileroModelUrl from '@voice/models/silero-vad-6.2.1.onnx?url'
import { SPEECH_SETTINGS } from '@shared/speech-settings'
import { SPEECH_SAMPLE_RATE } from '@shared/wav'

/** Silero (v5 and later) looks at the last 64 samples of the previous window along with each new one. */
const CONTEXT_SAMPLES = 64
const STATE_SHAPE = [2, 1, 128]

/** Silero VAD on 16 kHz audio, one 512-sample window at a time, as silero-vad's own OnnxWrapper runs it. */
export class SileroVoiceDetector {
    private state: Float32Array = new Float32Array(2 * 128)
    private context: Float32Array = new Float32Array(CONTEXT_SAMPLES)
    private readonly sampleRate = new onnxRuntime.Tensor('int64', BigInt64Array.from([BigInt(SPEECH_SAMPLE_RATE)]), [])

    private constructor(private readonly session: onnxRuntime.InferenceSession) {}

    static async create(): Promise<SileroVoiceDetector> {
        onnxRuntime.env.wasm.wasmPaths = { mjs: runtimeModuleUrl, wasm: runtimeBinaryUrl }
        // Threads need cross-origin isolation, which the renderer doesn't have; one is plenty for Silero.
        onnxRuntime.env.wasm.numThreads = 1
        const session = await onnxRuntime.InferenceSession.create(sileroModelUrl, { executionProviders: ['wasm'] })
        return new SileroVoiceDetector(session)
    }

    /** The chance the window holds speech, 0 to 1. */
    async speechProbability(window: Float32Array): Promise<number> {
        const windowSamples = SPEECH_SETTINGS.detector.windowSamples
        if (window.length !== windowSamples) throw new Error(`Silero takes ${windowSamples} samples at a time`)
        const input = new Float32Array(CONTEXT_SAMPLES + windowSamples)
        input.set(this.context)
        input.set(window, CONTEXT_SAMPLES)
        const outputs = await this.session.run({
            input: new onnxRuntime.Tensor('float32', input, [1, input.length]),
            state: new onnxRuntime.Tensor('float32', this.state, STATE_SHAPE),
            sr: this.sampleRate,
        })
        this.state = outputs.stateN.data as Float32Array
        this.context = input.slice(-CONTEXT_SAMPLES)
        return (outputs.output.data as Float32Array)[0]
    }

    reset(): void {
        this.state = new Float32Array(2 * 128)
        this.context = new Float32Array(CONTEXT_SAMPLES)
    }
}
