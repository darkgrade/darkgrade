/// <reference lib="webworker" />
/**
 * Runs on the audio rendering thread. The AudioContext already runs at 16 kHz, so this only
 * gathers 80 ms blocks, converts them to PCM16 for the speech engine and measures their level.
 */

declare const sampleRate: number
declare class AudioWorkletProcessor {
    readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: unknown): void

const BLOCK_SECONDS = 0.08
const BLOCK_SAMPLES = Math.round(sampleRate * BLOCK_SECONDS)

class MicrophoneCaptureProcessor extends AudioWorkletProcessor {
    private block = new Int16Array(BLOCK_SAMPLES)
    private filled = 0
    private sumOfSquares = 0
    private audioPort: MessagePort | null = null

    constructor() {
        super()
        this.port.onmessage = (event: MessageEvent<{ audioPort: MessagePort }>) => {
            this.audioPort = event.data.audioPort
        }
    }

    process(inputs: Float32Array[][]): boolean {
        const samples = inputs[0]?.[0]
        if (!samples) return true
        for (const sample of samples) {
            const clamped = Math.max(-1, Math.min(1, sample))
            this.block[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
            this.sumOfSquares += clamped * clamped
            if (this.filled === BLOCK_SAMPLES) this.flush()
        }
        return true
    }

    private flush(): void {
        const level = Math.sqrt(this.sumOfSquares / BLOCK_SAMPLES)
        // Transferring the block hands its memory to the worker, so the next block is a new array.
        const audio = this.block.buffer
        this.audioPort?.postMessage(audio, [audio])
        this.port.postMessage(level)
        this.block = new Int16Array(BLOCK_SAMPLES)
        this.filled = 0
        this.sumOfSquares = 0
    }
}

registerProcessor('microphone-capture', MicrophoneCaptureProcessor)
