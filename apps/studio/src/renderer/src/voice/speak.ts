/** Voice options for spoken replies. Kokoro voices run fully on-device. */
export interface TtsVoiceOption {
    id: string
    label: string
}

export const KOKORO_VOICES: TtsVoiceOption[] = [
    { id: 'af_heart', label: 'Heart — US female' },
    { id: 'af_bella', label: 'Bella — US female' },
    { id: 'af_nicole', label: 'Nicole — US female (whisper)' },
    { id: 'am_michael', label: 'Michael — US male' },
    { id: 'am_fenrir', label: 'Fenrir — US male' },
    { id: 'bf_emma', label: 'Emma — UK female' },
    { id: 'bm_george', label: 'George — UK male' },
]

export const DEFAULT_TTS_VOICE = 'af_heart'
export const TTS_VOICE_STORAGE_KEY = 'studio.ttsVoice'

export function isSystemVoice(voiceId: string): boolean {
    return voiceId.startsWith('system:')
}

/** Fallback: OS speech synthesizer (still local, just not neural). */
export function speakWithSystemVoice(text: string, voiceId?: string): void {
    if (typeof speechSynthesis === 'undefined') return
    speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1.1
    if (voiceId && isSystemVoice(voiceId)) {
        const wanted = voiceId.slice('system:'.length)
        const match = speechSynthesis.getVoices().find(voice => voice.name === wanted)
        if (match) utterance.voice = match
    }
    speechSynthesis.speak(utterance)
}

export function listSystemVoices(): string[] {
    if (typeof speechSynthesis === 'undefined') return []
    return speechSynthesis
        .getVoices()
        .filter(voice => voice.lang.startsWith('en'))
        .map(voice => voice.name)
}
