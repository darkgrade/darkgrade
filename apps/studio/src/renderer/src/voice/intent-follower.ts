import type { StudioApi, VoiceIntent } from '@shared/ipc'
import { intentHighlights, transcriptText } from '@voice/transcript-store'

/**
 * New words go to the assistant once a sentence ends (the speech model punctuates) and the speaker
 * settles briefly, or after a longer wait when there's no punctuation; a pause hands them over at
 * once. Never mid-sentence: "Set the… aperture to… f4" sent in pieces asks "what aperture?".
 */
const SETTLE_AFTER_SENTENCE_MS = 60
const SETTLE_WITHOUT_PUNCTUATION_MS = 2000
/** Earlier transcript sent along, so the assistant knows what was already said and handled. */
const CONTEXT_CHARACTERS = 160

interface Segment {
    start: number
    text: string
}

/** The quote's position in the segment, matching words while ignoring case and punctuation. */
export function locateQuote(segment: string, quote: string): { start: number; end: number } | null {
    const words = quote.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    if (!words?.length) return null
    const pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+'), 'iu')
    const match = pattern.exec(segment)
    return match ? { start: match.index, end: match.index + match[0].length } : null
}

/**
 * Follows the live transcript a step behind: once the speaker settles (or pauses), the words not yet
 * looked at go to the assistant, which finds and carries out camera requests. Each request it
 * reports is placed back on the words that made it, for highlighting.
 */
export class IntentFollower {
    private processedLength = 0
    private nextSegmentId = 1
    private segments = new Map<number, Segment>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private lastWordAtMs = 0
    private unsubscribe: () => void

    constructor(private readonly api: StudioApi) {
        this.unsubscribe = api.onVoiceIntent(intent => this.place(intent))
    }

    /** New words arrived. */
    notify(): void {
        if (this.timer) clearTimeout(this.timer)
        this.lastWordAtMs = Date.now()
        this.warmUp()
        const endsSentence = /[.?!]["'”’)]?\s*$/.test(transcriptText())
        this.timer = setTimeout(() => this.flush(), endsSentence ? SETTLE_AFTER_SENTENCE_MS : SETTLE_WITHOUT_PUNCTUATION_MS)
    }

    /** The speaker paused or stopped: look at what's new right away. */
    flush(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        const text = transcriptText()
        if (text.length <= this.processedLength) return
        const segment: Segment = { start: this.processedLength, text: text.slice(this.processedLength) }
        const context = text.slice(Math.max(0, this.processedLength - CONTEXT_CHARACTERS), this.processedLength)
        this.processedLength = text.length
        if (!/[\p{L}\p{N}]/u.test(segment.text)) return
        const segmentId = this.nextSegmentId++
        this.segments.set(segmentId, segment)
        void this.api.assistantProcessTranscript({
            segmentId,
            text: segment.text,
            context,
            lastWordAtMs: this.lastWordAtMs,
            handedOverAtMs: Date.now(),
        })
    }

    /** Lets the assistant read the words so far while the sentence is still going. */
    private warmUp(): void {
        const text = transcriptText()
        if (text.length <= this.processedLength) return
        const context = text.slice(Math.max(0, this.processedLength - CONTEXT_CHARACTERS), this.processedLength)
        void this.api.assistantWarmUp({ text: text.slice(this.processedLength), context })
    }

    /** The transcript was cleared: forget positions, keep listening. */
    reset(): void {
        if (this.timer) clearTimeout(this.timer)
        this.timer = null
        this.processedLength = 0
        this.segments.clear()
        intentHighlights.set([])
    }

    dispose(): void {
        this.reset()
        this.unsubscribe()
    }

    private place(intent: VoiceIntent): void {
        const highlights = intentHighlights.get()
        const existing = highlights.find(highlight => highlight.id === intent.id)
        if (existing) {
            intentHighlights.set(highlights.map(highlight => (highlight.id === intent.id ? { ...highlight, state: intent.state, reply: intent.reply } : highlight)))
            return
        }
        const segment = this.segments.get(intent.segmentId)
        const found = segment && locateQuote(segment.text, intent.quote)
        if (!segment || !found) return
        const start = segment.start + found.start
        intentHighlights.set([...highlights, { id: intent.id, start, end: segment.start + found.end, state: intent.state, reply: intent.reply }])
    }
}
