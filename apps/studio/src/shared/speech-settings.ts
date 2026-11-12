/**
 * How Studio hears speech, recorded in one place so a Voicebench run can be compared with Studio.
 * Voicebench cuts finished recordings offline with Silero VAD (bench/runners/find_utterances.py) and
 * scores Bark through bench/runners/transcription_server.py; Studio does the same live.
 */
export const SPEECH_SETTINGS = {
    recognizer: {
        model: 'Underdog Bark 3.0 Plus',
        source: 'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Plus',
        revision: '28a7d4234146b0f01c11e0c6b72dfa29028a4758',
        licence: 'CC-BY-NC-4.0',
        runtime: 'MLX (bark_mlx.py from the pinned model download), fp16',
        /** Added by bark_mlx.transcribe before every clip, as the model's own runtime does. */
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
        /** As Voicebench (min_silence_duration_ms=500); Silero's 0.1 s default splits at every breath. */
        endOfUtteranceSeconds: 0.5,
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
