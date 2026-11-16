/// <reference lib="webworker" />
/**
 * Hears speech live with Silero VAD, cuts it into utterances and has the local speech engine (Bark,
 * whole utterances only) transcribe each one. While an utterance is being spoken it is re-transcribed
 * every partialIntervalSeconds and shown as partial text; its final words arrive once it ends.
 * Runs off the UI thread; audio arrives straight from the worklet as 16 kHz PCM16 blocks.
 */
import { SPEECH_SETTINGS } from '@shared/speech-settings'
import { SPEECH_SAMPLE_RATE, wavFile } from '@shared/wav'
import { SileroVoiceDetector } from '@voice/silero-voice-detector'
import type { TranscriptionCommand, TranscriptionEvent } from '@voice/transcription-protocol'
import { concatenate, type Utterance, UtteranceCutter } from '@voice/utterance-cutter'

const WINDOW_SAMPLES = SPEECH_SETTINGS.detector.windowSamples
const PARTIAL_INTERVAL_SAMPLES = Math.round(SPEECH_SETTINGS.live.partialIntervalSeconds * SPEECH_SAMPLE_RATE)
/** A gap this long between audio blocks means the microphone path stalled. */
const AUDIO_GAP_WARNING_MS = 300
/** Audio kept for replaying a bad transcript. Ten minutes at most. */
const MAX_RECORDED_SAMPLES = 10 * 60 * SPEECH_SAMPLE_RATE

let enginePort = 0
let stopping = false
let detector: SileroVoiceDetector | null = null
let lastAudioMilliseconds = 0
let recordedBlocks: Int16Array[] = []
let recordedSamples = 0
let pendingSamples: Int16Array = new Int16Array(0)
/** Windows go through Silero one at a time, in order. */
let detection: Promise<void> = Promise.resolve()
/** Final transcriptions run one at a time, so their words arrive in the order they were spoken. */
let finals: Promise<void> = Promise.resolve()
let finalsPending = 0
let partialInFlight = false
let samplesSincePartial = 0
/** Bumped when an utterance ends, so a partial that comes back after it is dropped. */
let utteranceGeneration = 0

function emit(event: TranscriptionEvent): void {
    self.postMessage(event)
}

function diagnostic(message: string): void {
    emit({ type: 'diagnostic', message })
}

async function requestTranscript(samples: Int16Array): Promise<string> {
    const pcm = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)
    const form = new FormData()
    form.append('file', new Blob([wavFile(pcm)], { type: 'audio/wav' }), 'utterance.wav')
    const response = await fetch(`http://127.0.0.1:${enginePort}/v1/audio/transcriptions`, { method: 'POST', body: form })
    const body = (await response.json()) as { text?: string; error?: string }
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    return body.text?.trim() ?? ''
}

async function transcribeFinal(utterance: Utterance): Promise<void> {
    const sentMilliseconds = performance.now()
    try {
        const text = await requestTranscript(utterance.samples)
        const waitMilliseconds = Math.round(performance.now() - sentMilliseconds)
        const durationSeconds = utterance.samples.length / SPEECH_SAMPLE_RATE
        diagnostic(`utterance at ${utterance.startSeconds.toFixed(2)} s (${durationSeconds.toFixed(2)} s) in ${waitMilliseconds} ms: ${JSON.stringify(text)}`)
        if (text) emit({ type: 'delta', text: ` ${text}` })
        else emit({ type: 'partial', text: '' })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        diagnostic(`engine error: ${message}`)
        emit({ type: 'partial', text: '' })
        emit({ type: 'error', message: `The speech engine couldn't transcribe that: ${message}` })
    }
}

async function transcribePartial(utterance: Utterance): Promise<void> {
    const generation = utteranceGeneration
    partialInFlight = true
    try {
        const text = await requestTranscript(utterance.samples)
        if (generation === utteranceGeneration && finalsPending === 0) emit({ type: 'partial', text })
    } catch (error) {
        diagnostic(`partial transcription failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        partialInFlight = false
    }
}

const cutter = new UtteranceCutter({
    onUtterance: utterance => {
        utteranceGeneration++
        samplesSincePartial = 0
        finalsPending++
        finals = finals.then(() => transcribeFinal(utterance)).finally(() => finalsPending--)
    },
    onDiscarded: () => {
        utteranceGeneration++
        samplesSincePartial = 0
        emit({ type: 'partial', text: '' })
    },
})

function requestPartialWhenDue(): void {
    if (!cutter.speaking || partialInFlight || finalsPending > 0) return
    if (samplesSincePartial < PARTIAL_INTERVAL_SAMPLES) return
    const utterance = cutter.currentUtterance()
    if (!utterance) return
    samplesSincePartial = 0
    void transcribePartial(utterance)
}

async function detectWindow(window: Int16Array): Promise<void> {
    if (!detector) return
    const floatWindow = Float32Array.from(window, sample => sample / 32768)
    const probability = await detector.speechProbability(floatWindow)
    cutter.addWindow(window, probability)
    if (cutter.speaking) samplesSincePartial += window.length
    requestPartialWhenDue()
}

function receiveAudio(buffer: ArrayBuffer): void {
    if (stopping) return
    const now = performance.now()
    if (lastAudioMilliseconds && now - lastAudioMilliseconds > AUDIO_GAP_WARNING_MS) {
        diagnostic(`audio gap ${Math.round(now - lastAudioMilliseconds)} ms`)
    }
    lastAudioMilliseconds = now
    const block = new Int16Array(buffer.slice(0))
    if (recordedSamples < MAX_RECORDED_SAMPLES) {
        recordedBlocks.push(block)
        recordedSamples += block.length
    }
    let samples = concatenate([pendingSamples, block])
    while (samples.length >= WINDOW_SAMPLES) {
        const window = samples.slice(0, WINDOW_SAMPLES)
        samples = samples.slice(WINDOW_SAMPLES)
        detection = detection.then(() => detectWindow(window))
    }
    pendingSamples = samples
}

function emitSessionAudio(): void {
    if (recordedBlocks.length === 0) return
    const samples = concatenate(recordedBlocks)
    recordedBlocks = []
    recordedSamples = 0
    diagnostic(`session ended: ${(samples.length / SPEECH_SAMPLE_RATE).toFixed(2)} s of audio`)
    const pcm = samples.buffer as ArrayBuffer
    self.postMessage({ type: 'session-audio', pcm } satisfies TranscriptionEvent, [pcm])
}

async function stop(): Promise<void> {
    stopping = true
    await detection
    cutter.flush()
    await finals
    emitSessionAudio()
    emit({ type: 'stopped' })
}

async function start(command: Extract<TranscriptionCommand, { type: 'start' }>): Promise<void> {
    stopping = false
    enginePort = command.enginePort
    try {
        const response = await fetch(`http://127.0.0.1:${enginePort}/health`)
        if (!response.ok) throw new Error(`speech engine answered HTTP ${response.status}`)
        detector ??= await SileroVoiceDetector.create(enginePort)
        detector.reset()
    } catch (error) {
        emit({ type: 'error', message: `Couldn't start listening: ${error instanceof Error ? error.message : String(error)}` })
        emit({ type: 'stopped' })
        return
    }
    diagnostic(`speech settings ${JSON.stringify(SPEECH_SETTINGS)}`)
    command.audioPort.onmessage = (audio: MessageEvent<ArrayBuffer>) => receiveAudio(audio.data)
    emit({ type: 'listening' })
}

self.onmessage = (event: MessageEvent<TranscriptionCommand>) => {
    const command = event.data
    if (command.type === 'start') void start(command)
    if (command.type === 'stop') void stop()
}
