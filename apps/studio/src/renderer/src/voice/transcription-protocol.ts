/** Messages between the UI and the transcription worker. */

export type TranscriptionCommand = { type: 'start'; enginePort: number; audioPort: MessagePort } | { type: 'stop' }

export type TranscriptionEvent =
    | { type: 'listening' }
    /** An utterance's final words; only these join the transcript the assistant follows. */
    | { type: 'delta'; text: string }
    /** The utterance being spoken so far; shown, then replaced by its delta. Never acted on. */
    | { type: 'partial'; text: string }
    /** The worker started a new session; the transcript continues on a new paragraph. */
    | { type: 'paragraph' }
    | { type: 'error'; message: string }
    /** A timing note for the engine log: audio gaps, slow sends, session events. */
    | { type: 'diagnostic'; message: string }
    /** Every block sent this session, as PCM16 at 16 kHz, so a bad transcript can be replayed. */
    | { type: 'session-audio'; pcm: ArrayBuffer }
    | { type: 'stopped' }
