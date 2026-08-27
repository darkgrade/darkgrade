import type { AsrModelKey } from '@voice/asr-models'
import { ASR_MODEL_STORAGE_KEY, DEFAULT_ASR_MODEL, isAsrModelKey } from '@voice/asr-models'
import { INTENT_PARSER_VERSION, stripWakeWord } from '@voice/intent-parser'
import {
    DEFAULT_TTS_VOICE,
    isSystemVoice,
    listSystemVoices,
    speakWithSystemVoice,
    TTS_VOICE_STORAGE_KEY,
} from '@voice/speak'
import type { TtsOutMessage } from '@voice/tts-worker'
import type { WorkerOutMessage } from '@voice/whisper-worker'
import { useCallback, useEffect, useRef, useState } from 'react'

const SAMPLE_RATE = 16000
const PROCESSOR_BUFFER_SIZE = 2048 // 128 ms frames at 16 kHz
const PRE_ROLL_FRAMES = 4
const SPEECH_START_FRAMES = 2
const SPEECH_END_FRAMES = 6 // ~770 ms of silence ends a segment
const MIN_SEGMENT_SECONDS = 0.35
const MAX_SEGMENT_SECONDS = 12
const NOISE_FLOOR_ALPHA = 0.05
const MIN_SPEECH_RMS = 0.01
const NOISE_FLOOR_MULTIPLIER = 3.5

export type VoiceMode = 'off' | 'continuous'
export type ModelStatus = 'loading' | 'ready' | 'error'
export type TtsStatus = 'loading' | 'ready' | 'error'

const TTS_ECHO_GRACE_MS = 500

export interface VoiceActivity {
    transcript: string
    reply: string
    ok: boolean
    timestampMs: number
}

export interface UseVoiceOptions {
    /** Executes a transcript; returns the reply to show/speak, or null if no intent matched. */
    onTranscript: (transcript: string) => Promise<{ reply: string; ok: boolean } | null>
    onLog: (message: string, level?: 'info' | 'error') => void
}

export interface UseVoiceResult {
    modelStatus: ModelStatus
    modelDevice: string | null
    modelProgress: { file: string; progress: number } | null
    modelError: string | null
    /** Speech-recognition model selection */
    asrModel: AsrModelKey
    setAsrModel: (model: AsrModelKey) => void
    mode: VoiceMode
    setMode: (mode: VoiceMode) => void
    pttActive: boolean
    startPtt: () => void
    stopPtt: () => void
    speaking: boolean
    transcribing: boolean
    wakeWordRequired: boolean
    setWakeWordRequired: (value: boolean) => void
    speakReplies: boolean
    setSpeakReplies: (value: boolean) => void
    lastActivity: VoiceActivity | null
    micError: string | null
    /** Neural (Kokoro) TTS state + voice selection */
    ttsStatus: TtsStatus
    ttsDevice: string | null
    ttsVoice: string
    setTtsVoice: (voiceId: string) => void
    systemVoices: string[]
}

function computeRms(samples: Float32Array): number {
    let sum = 0
    for (let index = 0; index < samples.length; index++) sum += samples[index] * samples[index]
    return Math.sqrt(sum / samples.length)
}

function concatFrames(frames: Float32Array[]): Float32Array {
    const totalLength = frames.reduce((length, frame) => length + frame.length, 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const frame of frames) {
        merged.set(frame, offset)
        offset += frame.length
    }
    return merged
}

export function useVoice(options: UseVoiceOptions): UseVoiceResult {
    const [modelStatus, setModelStatus] = useState<ModelStatus>('loading')
    const [modelDevice, setModelDevice] = useState<string | null>(null)
    const [modelProgress, setModelProgress] = useState<{ file: string; progress: number } | null>(null)
    const [modelError, setModelError] = useState<string | null>(null)
    const [mode, setModeState] = useState<VoiceMode>('off')
    const [pttActive, setPttActive] = useState(false)
    const [speaking, setSpeaking] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [wakeWordRequired, setWakeWordRequired] = useState(true)
    const [speakReplies, setSpeakReplies] = useState(true)
    const [lastActivity, setLastActivity] = useState<VoiceActivity | null>(null)
    const [micError, setMicError] = useState<string | null>(null)

    const workerRef = useRef<Worker | null>(null)
    const audioContextRef = useRef<AudioContext | null>(null)
    const mediaStreamRef = useRef<MediaStream | null>(null)
    const processorRef = useRef<ScriptProcessorNode | null>(null)
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

    const capturingRef = useRef(false) // PTT capture in progress
    const modeRef = useRef<VoiceMode>('off')
    const framesRef = useRef<Float32Array[]>([])
    const preRollRef = useRef<Float32Array[]>([])
    const speechActiveRef = useRef(false)
    const aboveCountRef = useRef(0)
    const belowCountRef = useRef(0)
    const noiseFloorRef = useRef(0.005)
    const transcribeIdRef = useRef(0)
    const pendingRef = useRef(new Map<number, (text: string | null) => void>())

    const optionsRef = useRef(options)
    optionsRef.current = options

    const speakRepliesRef = useRef(speakReplies)
    speakRepliesRef.current = speakReplies
    const wakeWordRequiredRef = useRef(wakeWordRequired)
    wakeWordRequiredRef.current = wakeWordRequired

    // ------------------------------------------------------------ neural TTS

    const [ttsStatus, setTtsStatus] = useState<TtsStatus>('loading')
    const [ttsDevice, setTtsDevice] = useState<string | null>(null)
    const [ttsVoice, setTtsVoiceState] = useState<string>(
        () => localStorage.getItem(TTS_VOICE_STORAGE_KEY) ?? DEFAULT_TTS_VOICE
    )
    const [systemVoices, setSystemVoices] = useState<string[]>([])

    const ttsWorkerRef = useRef<Worker | null>(null)
    const ttsStatusRef = useRef<TtsStatus>('loading')
    ttsStatusRef.current = ttsStatus
    const ttsVoiceRef = useRef(ttsVoice)
    ttsVoiceRef.current = ttsVoice
    const ttsIdRef = useRef(0)
    const ttsPendingRef = useRef(new Map<number, (wav: ArrayBuffer | null) => void>())
    const playbackRef = useRef<HTMLAudioElement | null>(null)
    /** True while a reply is playing (+ grace) — suppresses the mic so we don't transcribe ourselves. */
    const ttsPlayingRef = useRef(false)

    useEffect(() => {
        const worker = new Worker(new URL('./tts-worker.ts', import.meta.url), { type: 'module' })
        ttsWorkerRef.current = worker
        worker.onmessage = (event: MessageEvent<TtsOutMessage>) => {
            const message = event.data
            switch (message.type) {
                case 'ready':
                    setTtsStatus('ready')
                    setTtsDevice(message.device)
                    optionsRef.current.onLog(`Neural voice ready (${message.device})`)
                    break
                case 'load-error':
                    setTtsStatus('error')
                    optionsRef.current.onLog(
                        `Neural voice failed to load, using system voice: ${message.error}`,
                        'error'
                    )
                    break
                case 'audio': {
                    const resolve = ttsPendingRef.current.get(message.id)
                    ttsPendingRef.current.delete(message.id)
                    resolve?.(message.wav)
                    break
                }
                case 'speak-error': {
                    const resolve = ttsPendingRef.current.get(message.id)
                    ttsPendingRef.current.delete(message.id)
                    resolve?.(null)
                    break
                }
            }
        }
        worker.postMessage({ type: 'load' })
        return () => {
            worker.terminate()
            ttsWorkerRef.current = null
        }
    }, [])

    // System voice list loads asynchronously
    useEffect(() => {
        const refresh = (): void => setSystemVoices(listSystemVoices())
        refresh()
        speechSynthesis?.addEventListener?.('voiceschanged', refresh)
        return () => speechSynthesis?.removeEventListener?.('voiceschanged', refresh)
    }, [])

    const stopPlayback = useCallback(() => {
        playbackRef.current?.pause()
        playbackRef.current = null
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    }, [])

    const speakReply = useCallback(
        (text: string) => {
            if (!speakRepliesRef.current || !text) return
            stopPlayback()

            const voiceId = ttsVoiceRef.current
            if (isSystemVoice(voiceId) || ttsStatusRef.current !== 'ready' || !ttsWorkerRef.current) {
                speakWithSystemVoice(text, voiceId)
                return
            }

            const id = ++ttsIdRef.current
            const worker = ttsWorkerRef.current
            ttsPendingRef.current.set(id, wav => {
                if (id !== ttsIdRef.current) return // superseded by a newer reply
                if (!wav) {
                    speakWithSystemVoice(text)
                    return
                }
                const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }))
                const audio = new Audio(url)
                playbackRef.current = audio
                ttsPlayingRef.current = true
                const done = (): void => {
                    URL.revokeObjectURL(url)
                    setTimeout(() => {
                        ttsPlayingRef.current = false
                    }, TTS_ECHO_GRACE_MS)
                }
                audio.onended = done
                audio.onerror = done
                void audio.play().catch(done)
            })
            worker.postMessage({ type: 'speak', id, text, voice: voiceId })
        },
        [stopPlayback]
    )

    const setTtsVoice = useCallback(
        (voiceId: string) => {
            setTtsVoiceState(voiceId)
            ttsVoiceRef.current = voiceId
            localStorage.setItem(TTS_VOICE_STORAGE_KEY, voiceId)
            speakReply('ISO 800')
        },
        [speakReply]
    )

    // ---------------------------------------------------------------- worker

    const [asrModel, setAsrModelState] = useState<AsrModelKey>(() => {
        const stored = localStorage.getItem(ASR_MODEL_STORAGE_KEY)
        return isAsrModelKey(stored) ? stored : DEFAULT_ASR_MODEL
    })

    const setAsrModel = useCallback((model: AsrModelKey) => {
        localStorage.setItem(ASR_MODEL_STORAGE_KEY, model)
        setAsrModelState(model)
    }, [])

    // Recreated whenever the model changes; in-flight transcriptions resolve null.
    useEffect(() => {
        setModelStatus('loading')
        setModelDevice(null)
        setModelError(null)
        setModelProgress(null)

        const worker = new Worker(new URL('./whisper-worker.ts', import.meta.url), { type: 'module' })
        workerRef.current = worker

        worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
            const message = event.data
            switch (message.type) {
                case 'progress':
                    setModelProgress({ file: message.file, progress: message.progress })
                    break
                case 'ready':
                    setModelStatus('ready')
                    setModelDevice(message.device)
                    setModelProgress(null)
                    optionsRef.current.onLog(
                        `Voice model ready (${message.model} · ${message.device}) · parser v${INTENT_PARSER_VERSION}`
                    )
                    break
                case 'load-error':
                    setModelStatus('error')
                    setModelError(message.error)
                    optionsRef.current.onLog(`Voice model failed to load: ${message.error}`, 'error')
                    break
                case 'result': {
                    const resolve = pendingRef.current.get(message.id)
                    pendingRef.current.delete(message.id)
                    resolve?.(message.text)
                    break
                }
                case 'transcribe-error': {
                    const resolve = pendingRef.current.get(message.id)
                    pendingRef.current.delete(message.id)
                    optionsRef.current.onLog(`Transcription error: ${message.error}`, 'error')
                    resolve?.(null)
                    break
                }
            }
        }

        worker.postMessage({ type: 'load', model: asrModel })
        return () => {
            worker.terminate()
            workerRef.current = null
            for (const resolve of pendingRef.current.values()) resolve(null)
            pendingRef.current.clear()
        }
    }, [asrModel])

    const transcribe = useCallback((audio: Float32Array): Promise<string | null> => {
        const worker = workerRef.current
        if (!worker) return Promise.resolve(null)
        const id = ++transcribeIdRef.current
        return new Promise(resolve => {
            pendingRef.current.set(id, resolve)
            worker.postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
        })
    }, [])

    // ------------------------------------------------------------- transcript

    const handleSegment = useCallback(
        async (audio: Float32Array, fromContinuous: boolean) => {
            setTranscribing(true)
            try {
                const rawText = await transcribe(audio)
                setTranscribing(false)
                if (!rawText) return

                const { stripped, hadWakeWord } = stripWakeWord(rawText)
                if (fromContinuous && wakeWordRequiredRef.current && !hadWakeWord) {
                    optionsRef.current.onLog(`Heard "${rawText}" — ignored (say "hey darkgrade, …" first)`)
                    return
                }

                const commandText = hadWakeWord ? stripped : rawText
                const result = await optionsRef.current.onTranscript(commandText)
                if (result === null) {
                    setLastActivity({
                        transcript: rawText,
                        reply: 'No matching command',
                        ok: false,
                        timestampMs: Date.now(),
                    })
                    return
                }
                setLastActivity({ transcript: rawText, reply: result.reply, ok: result.ok, timestampMs: Date.now() })
                speakReply(result.reply)
            } finally {
                setTranscribing(false)
            }
        },
        [transcribe, speakReply]
    )

    // ------------------------------------------------------------------ audio

    const handleAudioFrame = useCallback(
        (frame: Float32Array) => {
            // While a spoken reply is playing, ignore continuous-mode audio so
            // the app doesn't transcribe (and obey!) its own voice.
            if (ttsPlayingRef.current && !capturingRef.current) {
                speechActiveRef.current = false
                aboveCountRef.current = 0
                belowCountRef.current = 0
                framesRef.current = []
                preRollRef.current = []
                return
            }
            if (capturingRef.current) {
                framesRef.current.push(frame)
                return
            }
            if (modeRef.current !== 'continuous') return

            const rms = computeRms(frame)
            const threshold = Math.max(MIN_SPEECH_RMS, noiseFloorRef.current * NOISE_FLOOR_MULTIPLIER)

            if (!speechActiveRef.current) {
                noiseFloorRef.current = noiseFloorRef.current * (1 - NOISE_FLOOR_ALPHA) + rms * NOISE_FLOOR_ALPHA

                preRollRef.current.push(frame)
                if (preRollRef.current.length > PRE_ROLL_FRAMES) preRollRef.current.shift()

                if (rms > threshold) {
                    aboveCountRef.current++
                    if (aboveCountRef.current >= SPEECH_START_FRAMES) {
                        speechActiveRef.current = true
                        setSpeaking(true)
                        framesRef.current = [...preRollRef.current]
                        belowCountRef.current = 0
                    }
                } else {
                    aboveCountRef.current = 0
                }
                return
            }

            framesRef.current.push(frame)
            const segmentSeconds = (framesRef.current.length * PROCESSOR_BUFFER_SIZE) / SAMPLE_RATE

            if (rms <= threshold) {
                belowCountRef.current++
            } else {
                belowCountRef.current = 0
            }

            if (belowCountRef.current >= SPEECH_END_FRAMES || segmentSeconds >= MAX_SEGMENT_SECONDS) {
                speechActiveRef.current = false
                setSpeaking(false)
                aboveCountRef.current = 0
                belowCountRef.current = 0
                const frames = framesRef.current
                framesRef.current = []
                preRollRef.current = []
                if (segmentSeconds >= MIN_SEGMENT_SECONDS) {
                    void handleSegment(concatFrames(frames), true)
                }
            }
        },
        [handleSegment]
    )

    const ensureMicrophone = useCallback(async (): Promise<boolean> => {
        if (audioContextRef.current) return true
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
            })
            const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
            const source = audioContext.createMediaStreamSource(stream)
            const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 1, 1)
            processor.onaudioprocess = event => {
                handleAudioFrame(new Float32Array(event.inputBuffer.getChannelData(0)))
            }
            source.connect(processor)
            processor.connect(audioContext.destination)

            mediaStreamRef.current = stream
            audioContextRef.current = audioContext
            sourceRef.current = source
            processorRef.current = processor
            setMicError(null)
            return true
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setMicError(message)
            optionsRef.current.onLog(`Microphone unavailable: ${message}`, 'error')
            return false
        }
    }, [handleAudioFrame])

    const releaseMicrophoneIfIdle = useCallback(() => {
        if (modeRef.current !== 'off' || capturingRef.current) return
        processorRef.current?.disconnect()
        sourceRef.current?.disconnect()
        mediaStreamRef.current?.getTracks().forEach(track => track.stop())
        void audioContextRef.current?.close()
        processorRef.current = null
        sourceRef.current = null
        mediaStreamRef.current = null
        audioContextRef.current = null
    }, [])

    // ------------------------------------------------------------------- PTT

    const startPtt = useCallback(() => {
        if (capturingRef.current) return
        void ensureMicrophone().then(available => {
            if (!available) return
            capturingRef.current = true
            framesRef.current = []
            setPttActive(true)
            setSpeaking(true)
        })
    }, [ensureMicrophone])

    const stopPtt = useCallback(() => {
        if (!capturingRef.current) return
        capturingRef.current = false
        setPttActive(false)
        setSpeaking(false)
        const frames = framesRef.current
        framesRef.current = []
        const segmentSeconds = (frames.length * PROCESSOR_BUFFER_SIZE) / SAMPLE_RATE
        if (segmentSeconds >= MIN_SEGMENT_SECONDS) {
            void handleSegment(concatFrames(frames), false)
        }
        releaseMicrophoneIfIdle()
    }, [handleSegment, releaseMicrophoneIfIdle])

    const setMode = useCallback(
        (nextMode: VoiceMode) => {
            modeRef.current = nextMode
            setModeState(nextMode)
            if (nextMode === 'continuous') {
                void ensureMicrophone()
                optionsRef.current.onLog(
                    wakeWordRequiredRef.current
                        ? 'Always listening — start commands with "hey darkgrade, …"'
                        : 'Always listening — every phrase is treated as a command'
                )
            } else {
                speechActiveRef.current = false
                setSpeaking(false)
                framesRef.current = []
                preRollRef.current = []
                releaseMicrophoneIfIdle()
            }
        },
        [ensureMicrophone, releaseMicrophoneIfIdle]
    )

    // Hold Space to talk (ignored while typing in inputs)
    useEffect(() => {
        const isTypingTarget = (target: EventTarget | null): boolean => {
            const element = target as HTMLElement | null
            return (
                !!element &&
                (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
            )
        }
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.code === 'Space' && !event.repeat && !isTypingTarget(event.target)) {
                event.preventDefault()
                startPtt()
            }
        }
        const onKeyUp = (event: KeyboardEvent): void => {
            if (event.code === 'Space' && !isTypingTarget(event.target)) {
                event.preventDefault()
                stopPtt()
            }
        }
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('keyup', onKeyUp)
        }
    }, [startPtt, stopPtt])

    return {
        modelStatus,
        modelDevice,
        modelProgress,
        modelError,
        asrModel,
        setAsrModel,
        mode,
        setMode,
        pttActive,
        startPtt,
        stopPtt,
        speaking,
        transcribing,
        wakeWordRequired,
        setWakeWordRequired,
        speakReplies,
        setSpeakReplies,
        lastActivity,
        micError,
        ttsStatus,
        ttsDevice,
        ttsVoice,
        setTtsVoice,
        systemVoices,
    }
}
