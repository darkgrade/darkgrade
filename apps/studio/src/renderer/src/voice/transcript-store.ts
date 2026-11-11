import { createStore } from '@renderer/lib/external-store'

export const transcriptParagraphs = createStore<string[]>([])
export const microphoneLevel = createStore(0)

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
