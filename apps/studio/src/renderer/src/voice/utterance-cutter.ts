import { SPEECH_SETTINGS } from '@shared/speech-settings'
import { SPEECH_SAMPLE_RATE } from '@shared/wav'

const { detector, live } = SPEECH_SETTINGS
const WINDOW_SAMPLES = detector.windowSamples
const LEAD_IN_SAMPLES = Math.round(live.leadInSeconds * SPEECH_SAMPLE_RATE)
const END_SILENCE_SAMPLES = Math.round(detector.endOfUtteranceSeconds * SPEECH_SAMPLE_RATE)
const MINIMUM_SPEECH_SAMPLES = Math.round(detector.minimumSpeechSeconds * SPEECH_SAMPLE_RATE)
const MAXIMUM_UTTERANCE_SAMPLES = Math.round(live.maximumUtteranceSeconds * SPEECH_SAMPLE_RATE)
const SPLIT_SEARCH_SAMPLES = Math.round(live.splitSearchSeconds * SPEECH_SAMPLE_RATE)

export interface Utterance {
    /** 16 kHz PCM16 samples. */
    samples: Int16Array
    /** Where it starts in the session's audio. */
    startSeconds: number
}

export interface CutterEvents {
    /** An utterance ended (a pause, or the length cap); transcribe it for the transcript. */
    onUtterance: (utterance: Utterance) => void
    /** Speech stopped before it was long enough to be words; drop any partial text shown for it. */
    onDiscarded: () => void
}

function windowEnergy(samples: Int16Array, start: number): number {
    let sumOfSquares = 0
    for (let index = start; index < start + WINDOW_SAMPLES; index++) sumOfSquares += samples[index] * samples[index]
    return sumOfSquares
}

/**
 * Cuts live audio into utterances from Silero's per-window speech probabilities, with Silero's own
 * hysteresis: speech starts at the threshold and ends after endOfUtteranceSeconds below the negative
 * threshold. Keeps leadInSeconds from before the start, and splits an utterance longer than
 * maximumUtteranceSeconds at the quietest window of its last splitSearchSeconds.
 */
export class UtteranceCutter {
    private leadIn: Int16Array[] = []
    private current: Int16Array[] | null = null
    private currentSamples = 0
    private speechSamples = 0
    private silentSamples = 0
    private consumedSamples = 0
    private currentStartSample = 0

    constructor(private readonly events: CutterEvents) {}

    get speaking(): boolean {
        return this.current !== null
    }

    /** The utterance so far, for partial transcription. */
    currentUtterance(): Utterance | null {
        if (!this.current) return null
        return { samples: concatenate(this.current), startSeconds: this.currentStartSample / SPEECH_SAMPLE_RATE }
    }

    addWindow(window: Int16Array, speechProbability: number): void {
        this.consumedSamples += window.length
        if (!this.current) {
            this.waitForSpeech(window, speechProbability)
            return
        }
        this.current.push(window)
        this.currentSamples += window.length
        if (speechProbability >= detector.threshold) {
            this.speechSamples += window.length
            this.silentSamples = 0
        } else if (speechProbability < detector.negativeThreshold) {
            this.silentSamples += window.length
        }
        if (this.silentSamples >= END_SILENCE_SAMPLES) {
            this.finish()
            return
        }
        if (this.currentSamples >= MAXIMUM_UTTERANCE_SAMPLES) this.splitAtQuietestPoint()
    }

    /** The session ended: whatever is being said counts as finished. */
    flush(): void {
        if (this.current) this.finish()
    }

    private waitForSpeech(window: Int16Array, speechProbability: number): void {
        this.leadIn.push(window)
        while (this.leadIn.length * WINDOW_SAMPLES > LEAD_IN_SAMPLES + WINDOW_SAMPLES) this.leadIn.shift()
        if (speechProbability < detector.threshold) return
        this.current = this.leadIn
        this.leadIn = []
        this.currentSamples = this.current.reduce((sum, part) => sum + part.length, 0)
        this.currentStartSample = this.consumedSamples - this.currentSamples
        this.speechSamples = window.length
        this.silentSamples = 0
    }

    private finish(): void {
        const parts = this.current ?? []
        const longEnough = this.speechSamples >= MINIMUM_SPEECH_SAMPLES
        const startSeconds = this.currentStartSample / SPEECH_SAMPLE_RATE
        this.current = null
        this.currentSamples = 0
        this.speechSamples = 0
        this.silentSamples = 0
        if (longEnough) this.events.onUtterance({ samples: concatenate(parts), startSeconds })
        else this.events.onDiscarded()
    }

    private splitAtQuietestPoint(): void {
        const samples = concatenate(this.current ?? [])
        let quietestStart = samples.length - WINDOW_SAMPLES
        let quietestEnergy = Infinity
        for (let start = samples.length - SPLIT_SEARCH_SAMPLES; start + WINDOW_SAMPLES <= samples.length; start += WINDOW_SAMPLES) {
            const energy = windowEnergy(samples, start)
            if (energy < quietestEnergy) {
                quietestEnergy = energy
                quietestStart = start
            }
        }
        const splitAt = quietestStart + WINDOW_SAMPLES / 2
        this.events.onUtterance({ samples: samples.slice(0, splitAt), startSeconds: this.currentStartSample / SPEECH_SAMPLE_RATE })
        const remainder = samples.slice(splitAt)
        this.current = [remainder]
        this.currentSamples = remainder.length
        this.currentStartSample += splitAt
        this.speechSamples = remainder.length
        this.silentSamples = 0
    }
}

export function concatenate(parts: Int16Array[]): Int16Array {
    const joined = new Int16Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
        joined.set(part, offset)
        offset += part.length
    }
    return joined
}
