/**
 * How Studio hears speech, recorded in one place so a Voicebench run can be compared with Studio.
 * Voicebench cuts finished recordings offline with Silero VAD (bench/runners/find_utterances.py) and
 * scores Bark through bench/runners/transcription_server.py; Studio does the same live.
 */
export const SPEECH_SETTINGS = {
    recognizer: {
        /** The Bark model and its pinned revision are logged by the voice service when it loads one. */
        family: 'Underdog Bark 3.0 (CC-BY-NC-4.0)',
        /** Added before every clip, as each model's own runtime does. */
        leadingSilenceSeconds: 0.25,
    },
    detector: {
        model: 'silero-vad 6.2.1',
        /** sha256 of silero_vad.onnx in the silero-vad 6.2.1 package the speech engine installs. */
        modelSha256: '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3',
        runtime: 'onnxruntime-web 1.31.1 (WebAssembly)',
        /** Silero's defaults. */
        threshold: 0.5,
        negativeThreshold: 0.35,
        minimumSpeechSeconds: 0.25,
        windowSamples: 512,
        /**
         * Shorter than Voicebench's 0.5 s (min_silence_duration_ms=500) so commands act sooner; Silero's
         * 0.1 s default splits at every breath.
         */
        endOfUtteranceSeconds: 0.3,
    },
    /** Studio only: Voicebench has whole recordings and needs none of these. */
    live: {
        leadInSeconds: 0.3,
        maximumUtteranceSeconds: 15,
        /** A long utterance is split at the quietest point in this last stretch. */
        splitSearchSeconds: 1,
        partialIntervalSeconds: 0.7,
    },
} as const
