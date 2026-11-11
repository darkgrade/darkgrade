/// <reference lib="webworker" />
/**
 * Streams microphone audio to the local speech engine's realtime endpoint and sends the words
 * back as they're written. Runs off the UI thread; audio arrives straight from the worklet.
 */
import type { TranscriptionCommand, TranscriptionEvent } from '@voice/transcription-protocol'

/**
 * The speech model drifts on long sessions: after several minutes it starts dropping words (a run of
 * "stop recording" at minute seven never came out, while the same audio alone did). So a session is
 * renewed at the first pause after this long, and always after the hard limit.
 */
const SESSION_RENEW_AT_PAUSE_MS = 60_000
const SESSION_RENEW_ALWAYS_MS = 3 * 60_000
/** This many quiet blocks in a row (80 ms each) count as a pause. */
const PAUSE_BLOCKS = 8

let socket: WebSocket | null = null
let enginePort = 0
let sessionStartedMs = 0
let stopping = false
/** Audio blocks sent this run, kept for replaying a bad transcript. Ten minutes at most. */
const MAX_RECORDED_BLOCKS = (10 * 60) / 0.08
let recordedBlocks: Uint8Array[] = []
let lastAudioMs = 0
let audioBlocksSent = 0
let wordsReceived = 0
/** A gap this long between audio blocks means the microphone path stalled. */
const AUDIO_GAP_WARNING_MS = 300
/** Speech this long with no words back means the session stalled; a new one picks up from here. */
const STALL_RESTART_MS = 1600
/** RMS of a PCM16 block above this counts as speech. */
const SPEECH_LEVEL = 400
let lastDeltaMs = 0
let quietBlocks = 0
let speechWithoutWordsMs = 0

function blockLevel(buffer: ArrayBuffer): number {
    const samples = new Int16Array(buffer)
    let sumOfSquares = 0
    for (const sample of samples) sumOfSquares += sample * sample
    return Math.sqrt(sumOfSquares / samples.length)
}

function emit(event: TranscriptionEvent): void {
    self.postMessage(event)
}

function toBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
    }
    return btoa(binary)
}

function openSession(): void {
    const session = new WebSocket(`ws://127.0.0.1:${enginePort}/v1/realtime?intent=transcription`)
    socket = session
    sessionStartedMs = performance.now()
    // With this, a word's delay is its log time minus (this time + its audio position − this audio position).
    emit({ type: 'diagnostic', message: `session opened at ${(audioBlocksSent * 0.08).toFixed(2)} s of audio` })
    session.onopen = () => {
        session.send(
            JSON.stringify({
                type: 'session.update',
                session: { audio: { input: { format: { type: 'audio/pcm', rate: 16000 } } } },
            })
        )
    }
    session.onmessage = event => handleServerEvent(JSON.parse(String(event.data)))
    session.onclose = () => {
        if (socket !== session) return
        socket = null
        if (!stopping) emit({ type: 'error', message: 'Lost the connection to the speech engine' })
        emitSessionAudio()
        emit({ type: 'stopped' })
    }
}

function handleServerEvent(message: { type: string; delta?: string; error?: { message?: string } }): void {
    if (message.type === 'session.created') {
        emit({ type: 'listening' })
        return
    }
    if (message.type === 'conversation.item.input_audio_transcription.delta' && message.delta) {
        wordsReceived++
        emit({ type: 'diagnostic', message: `word at ${(audioBlocksSent * 0.08).toFixed(2)} s of audio: ${JSON.stringify(message.delta)}` })
        lastDeltaMs = performance.now()
        speechWithoutWordsMs = 0
        emit({ type: 'delta', text: message.delta })
        return
    }
    if (message.type === 'error') {
        emit({ type: 'diagnostic', message: `engine error: ${message.error?.message}` })
        emit({ type: 'error', message: message.error?.message ?? 'Speech engine error' })
    }
}

function sendAudio(buffer: ArrayBuffer): void {
    const now = performance.now()
    if (lastAudioMs && now - lastAudioMs > AUDIO_GAP_WARNING_MS) {
        emit({ type: 'diagnostic', message: `audio gap ${Math.round(now - lastAudioMs)} ms` })
    }
    lastAudioMs = now
    if (!socket || socket.readyState !== WebSocket.OPEN || stopping) {
        emit({ type: 'diagnostic', message: `dropped an audio block: socket ${socket?.readyState ?? 'missing'}` })
        return
    }
    if (recordedBlocks.length < MAX_RECORDED_BLOCKS) recordedBlocks.push(new Uint8Array(buffer.slice(0)))
    audioBlocksSent++
    if (audioBlocksSent % 125 === 0) {
        emit({
            type: 'diagnostic',
            message: `${audioBlocksSent} blocks sent, ${wordsReceived} deltas received, ${socket.bufferedAmount} bytes queued`,
        })
    }
    socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: toBase64(buffer) }))
    const speaking = blockLevel(buffer) > SPEECH_LEVEL
    quietBlocks = speaking ? 0 : quietBlocks + 1
    if (speaking && now - lastDeltaMs > 1000) speechWithoutWordsMs += 80
    if (speechWithoutWordsMs > STALL_RESTART_MS) {
        emit({ type: 'diagnostic', message: `no words for ${speechWithoutWordsMs} ms of speech; restarting the session` })
        speechWithoutWordsMs = 0
        lastDeltaMs = now
        emitSessionAudio()
        rotateSession()
        return
    }
    const sessionMs = now - sessionStartedMs
    if ((sessionMs > SESSION_RENEW_AT_PAUSE_MS && quietBlocks >= PAUSE_BLOCKS) || sessionMs > SESSION_RENEW_ALWAYS_MS) {
        emit({ type: 'diagnostic', message: `renewing the session after ${Math.round(sessionMs / 1000)} s` })
        rotateSession(false)
    }
}

/**
 * Finishes the current session and continues in a new one. The old session's last words still
 * arrive (it is told the input ended); `newParagraph` starts the next words on a new line.
 */
function rotateSession(newParagraph = true): void {
    const previous = socket
    if (!previous) return
    previous.onclose = null
    previous.onmessage = event => {
        const message = JSON.parse(String(event.data))
        handleServerEvent(message)
        if (message.type === 'conversation.item.input_audio_transcription.completed') previous.close()
    }
    previous.send(JSON.stringify({ type: 'input_audio_buffer.commit', final: true }))
    socket = null
    quietBlocks = 0
    openSession()
    if (newParagraph) emit({ type: 'paragraph' })
}

function emitSessionAudio(): void {
    const totalBytes = recordedBlocks.reduce((sum, block) => sum + block.length, 0)
    if (totalBytes === 0) return
    const pcm = new Uint8Array(totalBytes)
    let offset = 0
    for (const block of recordedBlocks) {
        pcm.set(block, offset)
        offset += block.length
    }
    recordedBlocks = []
    emit({ type: 'diagnostic', message: `session ended: ${audioBlocksSent} blocks sent, ${wordsReceived} deltas received` })
    self.postMessage({ type: 'session-audio', pcm: pcm.buffer } satisfies TranscriptionEvent, [pcm.buffer])
}

function stop(): void {
    stopping = true
    const session = socket
    if (!session) {
        emitSessionAudio()
        emit({ type: 'stopped' })
        return
    }
    if (session.readyState !== WebSocket.OPEN) {
        session.close()
        return
    }
    session.onmessage = event => {
        const message = JSON.parse(String(event.data))
        handleServerEvent(message)
        if (message.type === 'conversation.item.input_audio_transcription.completed') session.close()
    }
    session.send(JSON.stringify({ type: 'input_audio_buffer.commit', final: true }))
}

self.onmessage = (event: MessageEvent<TranscriptionCommand>) => {
    const command = event.data
    if (command.type === 'start') {
        stopping = false
        enginePort = command.enginePort
        lastDeltaMs = performance.now()
        speechWithoutWordsMs = 0
        command.audioPort.onmessage = (audio: MessageEvent<ArrayBuffer>) => sendAudio(audio.data)
        openSession()
        return
    }
    if (command.type === 'stop') stop()
}
