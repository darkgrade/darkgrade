import { createStore } from '@renderer/lib/external-store'

export const transcriptParagraphs = createStore<string[]>([])
export const microphoneLevel = createStore(0)
/**
 * The utterance still being spoken, as the speech model hears it so far. Shown only: it is replaced by
 * the utterance's final words and never goes to the assistant.
 */
export const transcriptPartial = createStore('')
/** Whether the words still being heard will start a new paragraph once confirmed, so they're shown there already. */
export const transcriptPartialNewParagraph = createStore(false)

/**
 * Whether an utterance starts a new paragraph: only after the last one ended a sentence, and only after a real
 * pause or a pause the speech model marked. Decided once, when the utterance is first heard, so its words never
 * move between paragraphs when they're confirmed.
 */
export function startsNewParagraph(previous: string[], paused: boolean, paragraphPending: boolean): boolean {
    const sentenceEnded = /[.?!]["'”’)]?\s*$/.test(previous.at(-1) ?? '')
    return previous.length > 0 && sentenceEnded && (paused || paragraphPending)
}

/** A request heard in the transcript: where its words are, and how far the assistant has got with it. */
export interface IntentHighlight {
    id: number
    /** Character range in the transcript's paragraphs joined with "\n". */
    start: number
    end: number
    state: 'recognized' | 'running' | 'done' | 'failed'
    reply: string | null
}

export const intentHighlights = createStore<IntentHighlight[]>([])

/** The whole transcript as one string; highlight offsets index into it. */
export function transcriptText(paragraphs: string[] = transcriptParagraphs.get()): string {
    return paragraphs.join('\n')
}
