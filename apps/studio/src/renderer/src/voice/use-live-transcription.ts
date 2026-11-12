import type { LocalModelStatus, VoiceEngineStatus } from '@shared/ipc'
import { DEFAULT_SPEECH_MODEL, type SpeechModelId } from '@shared/speech-models'
import { IntentFollower } from '@voice/intent-follower'
import microphoneWorkletUrl from '@voice/microphone-worklet?worker&url'
import { microphoneLevel, transcriptParagraphs, transcriptPartial } from '@voice/transcript-store'
import type { TranscriptionCommand, TranscriptionEvent } from '@voice/transcription-protocol'
import TranscriptionWorker from '@voice/transcription.worker?worker'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Microphone {
    deviceId: string
    label: string
}

export type ListeningState = 'off' | 'preparing' | 'listening' | 'stopping'

const SAMPLE_RATE = 16_000
const MICROPHONE_STORAGE_KEY = 'voice.microphoneId'
/** A pause this long starts a new paragraph. */
const PARAGRAPH_PAUSE_MS = 1400

function readStoredMicrophone(): string {
    try {
        return localStorage.getItem(MICROPHONE_STORAGE_KEY) ?? 'default'
    } catch {
        return 'default'
    }
}

function storeMicrophone(deviceId: string): void {
    try {
        localStorage.setItem(MICROPHONE_STORAGE_KEY, deviceId)
    } catch {
        // Remembering the choice is a convenience only.
    }
}

async function listMicrophones(): Promise<Microphone[]> {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
        .filter(device => device.kind === 'audioinput')
        .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '') || `Microphone ${index + 1}`,
        }))
}

function openMicrophone(deviceId: string): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
        audio: {
            deviceId: deviceId === 'default' ? undefined : { exact: deviceId },
            channelCount: 1,
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
        },
    })
}

interface Capture {
    context: AudioContext
    node: AudioWorkletNode
    source: MediaStreamAudioSourceNode
    stream: MediaStream
}

export function useLiveTranscription() {
    const api = window.studio
    const [engine, setEngine] = useState<VoiceEngineStatus | null>(null)
    const [assistant, setAssistant] = useState<LocalModelStatus | null>(null)
    const [listening, setListening] = useState<ListeningState>('off')
    const [error, setError] = useState<string | null>(null)
    const [microphones, setMicrophones] = useState<Microphone[]>([])
    const [microphoneId, setMicrophoneId] = useState(readStoredMicrophone)
    const [speechModelId, setSpeechModelId] = useState<SpeechModelId>(DEFAULT_SPEECH_MODEL)
    /** A model chosen mid-session: saved once the session stops, then listening resumes on it. */
    const pendingSpeechModelRef = useRef<SpeechModelId | null>(null)

    const workerRef = useRef<Worker | null>(null)
    const captureRef = useRef<Capture | null>(null)
    const paragraphPendingRef = useRef(false)
    const followerRef = useRef<IntentFollower | null>(null)
    useEffect(() => {
        const follower = new IntentFollower(api)
        followerRef.current = follower
        return () => follower.dispose()
    }, [api])

    useEffect(() => {
        void api.voiceGetStatus().then(result => result.ok && setEngine(result.data))
        return api.onVoiceStatus(setEngine)
    }, [api])

    useEffect(() => {
        void api.assistantGetStatus().then(result => result.ok && setAssistant(result.data))
        return api.onAssistantStatus(setAssistant)
    }, [api])

    useEffect(() => {
        void api.getPreferences().then(result => result.ok && setSpeechModelId(result.data.speechModel))
        return api.onPreferences(saved => setSpeechModelId(saved.speechModel))
    }, [api])

    const refreshMicrophones = useCallback(async () => setMicrophones(await listMicrophones()), [])
    useEffect(() => {
        void refreshMicrophones()
        navigator.mediaDevices.addEventListener('devicechange', refreshMicrophones)
        return () => navigator.mediaDevices.removeEventListener('devicechange', refreshMicrophones)
    }, [refreshMicrophones])

    const lastWordAtRef = useRef(0)

    /**
     * A new paragraph starts after a real pause between words, and only once the last sentence has
     * ended. (Going by the microphone level split quiet inputs into one word per line.)
     */
    const appendText = useCallback((text: string) => {
        const previous = transcriptParagraphs.get()
        const now = performance.now()
        const paused = lastWordAtRef.current > 0 && now - lastWordAtRef.current > PARAGRAPH_PAUSE_MS
        lastWordAtRef.current = now
        const sentenceEnded = /[.?!]["'”’)]?\s*$/.test(previous.at(-1) ?? '')
        const startNew = (paragraphPendingRef.current || paused) && sentenceEnded && previous.length > 0
        paragraphPendingRef.current = false
        if (startNew || previous.length === 0) {
            transcriptParagraphs.set([...previous, text.trimStart()])
        } else {
            const last = previous.at(-1)! + text
            transcriptParagraphs.set([
                ...previous.slice(0, -1),
                previous.length === 1 || last.trim() ? last : last.trimStart(),
            ])
        }
        followerRef.current?.notify()
    }, [])

    const handleLevel = useCallback((value: number) => microphoneLevel.set(value), [])

    const stopCapture = useCallback(async () => {
        const capture = captureRef.current
        captureRef.current = null
        if (!capture) return
        capture.stream.getTracks().forEach(track => track.stop())
        await capture.context.close()
        microphoneLevel.set(0)
    }, [])

    const startCapture = useCallback(
        async (deviceId: string): Promise<MessagePort> => {
            const stream = await openMicrophone(deviceId)
            const context = new AudioContext({ sampleRate: SAMPLE_RATE })
            await context.audioWorklet.addModule(microphoneWorkletUrl)
            const node = new AudioWorkletNode(context, 'microphone-capture')
            const source = context.createMediaStreamSource(stream)
            source.connect(node)
            node.port.onmessage = (event: MessageEvent<number>) => handleLevel(event.data)
            const channel = new MessageChannel()
            node.port.postMessage({ audioPort: channel.port1 }, [channel.port1])
            captureRef.current = { context, node, source, stream }
            void refreshMicrophones()
            return channel.port2
        },
        [handleLevel, refreshMicrophones]
    )

    const handleWorkerEvent = useCallback(
        (event: MessageEvent<TranscriptionEvent>) => {
            const message = event.data
            if (message.type === 'listening') setListening('listening')
            if (message.type === 'delta') {
                transcriptPartial.set('')
                appendText(message.text)
                // Each delta is a whole utterance that ended in a pause, so there is nothing to wait for.
                followerRef.current?.flush()
            }
            if (message.type === 'partial') {
                transcriptPartial.set(message.text)
                followerRef.current?.warmUpPartial(message.text)
            }
            if (message.type === 'paragraph') paragraphPendingRef.current = true
            if (message.type === 'error') setError(message.message)
            if (message.type === 'diagnostic') void api.voiceDiagnostic(message.message)
            if (message.type === 'session-audio') void api.voiceSaveSessionAudio(new Uint8Array(message.pcm))
            if (message.type !== 'stopped') return
            transcriptPartial.set('')
            workerRef.current?.terminate()
            workerRef.current = null
            void stopCapture()
            followerRef.current?.flush()
            setListening('off')
        },
        [api, appendText, stopCapture]
    )

    const start = useCallback(async () => {
        if (workerRef.current) return
        setError(null)
        setListening('preparing')
        try {
            // The assistant loads alongside, so the first request doesn't wait for it.
            void api.assistantPrepare()
            const prepared = await api.voicePrepare()
            if (!prepared.ok) throw new Error(prepared.error)
            const audioPort = await startCapture(microphoneId)
            const worker = new TranscriptionWorker()
            worker.onmessage = handleWorkerEvent
            workerRef.current = worker
            paragraphPendingRef.current = true
            const command: TranscriptionCommand = { type: 'start', enginePort: prepared.data, audioPort }
            worker.postMessage(command, [audioPort])
        } catch (caught) {
            await stopCapture()
            setListening('off')
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }, [api, handleWorkerEvent, microphoneId, startCapture, stopCapture])

    const stop = useCallback(async () => {
        const worker = workerRef.current
        if (!worker) return
        setListening('stopping')
        await stopCapture()
        const command: TranscriptionCommand = { type: 'stop' }
        worker.postMessage(command)
    }, [stopCapture])

    /** Switches the input; while listening, audio keeps flowing into the same session. */
    const chooseMicrophone = useCallback(async (deviceId: string) => {
        setMicrophoneId(deviceId)
        storeMicrophone(deviceId)
        const capture = captureRef.current
        if (!capture) return
        try {
            const stream = await openMicrophone(deviceId)
            const source = capture.context.createMediaStreamSource(stream)
            capture.source.disconnect()
            capture.stream.getTracks().forEach(track => track.stop())
            source.connect(capture.node)
            captureRef.current = { ...capture, source, stream }
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }, [])

    const saveSpeechModel = useCallback(
        async (id: SpeechModelId) => {
            const saved = await api.setPreferences({ speechModel: id })
            if (!saved.ok) setError(saved.error)
            const status = await api.voiceGetStatus()
            if (status.ok) setEngine(status.data)
        },
        [api]
    )

    /**
     * Switches the Bark model. While listening, the session stops first (so its last words reach the
     * old model), then the main process unloads the old model and listening resumes on the new one.
     */
    const chooseSpeechModel = useCallback(
        async (id: SpeechModelId) => {
            if (id === speechModelId) return
            setSpeechModelId(id)
            if (!workerRef.current) {
                await saveSpeechModel(id)
                return
            }
            pendingSpeechModelRef.current = id
            await stop()
        },
        [saveSpeechModel, speechModelId, stop]
    )

    useEffect(() => {
        const pending = pendingSpeechModelRef.current
        if (listening !== 'off' || !pending) return
        pendingSpeechModelRef.current = null
        void saveSpeechModel(pending).then(start)
    }, [listening, saveSpeechModel, start])

    const clear = useCallback(() => {
        transcriptParagraphs.set([])
        followerRef.current?.reset()
    }, [])

    useEffect(
        () => () => {
            workerRef.current?.terminate()
            void stopCapture()
        },
        [stopCapture]
    )

    const selectedMicrophone = microphones.some(microphone => microphone.deviceId === microphoneId)
        ? microphoneId
        : 'default'

    return {
        engine,
        assistant,
        listening,
        error,
        microphones,
        microphoneId: selectedMicrophone,
        start,
        stop,
        chooseMicrophone,
        speechModelId,
        chooseSpeechModel,
        clear,
    }
}

export type LiveTranscription = ReturnType<typeof useLiveTranscription>
