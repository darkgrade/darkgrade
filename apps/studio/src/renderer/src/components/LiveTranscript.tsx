import { Button } from '@kevinschaich/components'
import {
    intentHighlights,
    transcriptPartial,
    transcriptPartialNewParagraph,
    type IntentHighlight,
} from '@voice/transcript-store'
import { ArrowDown, Check, Loader, X } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface LiveTranscriptProps {
    paragraphs: string[]
    listening: boolean
    /** The microphone and engine are getting ready (already set up): the placeholder says so, without a caret. */
    preparing?: boolean
}

/** How close to the bottom still counts as following the latest words. */
const FOLLOW_THRESHOLD_PX = 48

/** Each word with the space after it, and where it starts in the text. */
function splitWords(text: string): { word: string; trailing: string; start: number }[] {
    return [...text.matchAll(/(\S+)(\s*)/g)].map(match => ({ word: match[1], trailing: match[2], start: match.index }))
}

const HIGHLIGHT_CLASS: Record<IntentHighlight['state'], string> = {
    recognized: 'transcript-intent transcript-intent-recognized',
    running: 'transcript-intent transcript-intent-running',
    done: 'transcript-intent transcript-intent-done',
    failed: 'transcript-intent transcript-intent-failed',
}

interface ParagraphProps {
    text: string
    latest: boolean
    /** Where this paragraph starts in the joined transcript, for placing highlights. */
    offset: number
    highlights: IntentHighlight[]
    /** The last paragraph ends with the words still being heard and the caret, on its own last line. */
    partial?: string
    caret?: boolean
}

/**
 * One paragraph. Every word keeps its own element, keyed by its place in the paragraph, from the moment it is first
 * heard: a word still being heard is grey, and when it's confirmed the same element turns white, so nothing vanishes
 * and fades back in. A request's words take its colour the same way, fading between states.
 */
const Paragraph = memo(
    function Paragraph({ text, offset, highlights, partial, caret }: ParagraphProps) {
        const words = splitWords(text).map(entry => ({
            ...entry,
            heard: false,
            highlight: highlights.find(
                range => range.start < offset + entry.start + entry.word.length && range.end > offset + entry.start
            ),
        }))
        // Words still being heard continue the paragraph's numbering, so each keeps its element once confirmed.
        const heard = splitWords(partial ?? '').map(entry => ({ ...entry, heard: true, highlight: undefined }))
        if (heard.length && words.length && !words.at(-1)!.trailing) words.at(-1)!.trailing = ' '
        const all = [...words, ...heard]
        const answered = highlights.filter(highlight => highlight.state !== 'recognized')
        return (
            <>
                <p className="transcript-paragraph">
                    {all.map((entry, index) => {
                        const { highlight } = entry
                        const first = highlight && all[index - 1]?.highlight !== highlight
                        const last = highlight && all[index + 1]?.highlight !== highlight
                        const edges = `${first ? ' transcript-intent-first' : ''}${last ? ' transcript-intent-last' : ''}`
                        return (
                            <span
                                key={index}
                                className={entry.heard ? 'transcript-word transcript-word-heard' : 'transcript-word'}
                            >
                                <span
                                    className={highlight ? HIGHLIGHT_CLASS[highlight.state] + edges : undefined}
                                    title={highlight?.reply ?? undefined}
                                >
                                    {last ? entry.word : entry.word + entry.trailing}
                                </span>
                                {last ? entry.trailing : null}
                            </span>
                        )
                    })}
                    {caret && <span className="transcript-caret" aria-hidden />}
                </p>
                {answered.map(highlight => (
                    <AssistantReply key={highlight.id} highlight={highlight} />
                ))}
            </>
        )
    },
    (previous, next) =>
        previous.text === next.text &&
        previous.latest === next.latest &&
        previous.partial === next.partial &&
        previous.caret === next.caret &&
        previous.offset === next.offset &&
        highlightKey(previous.highlights) === highlightKey(next.highlights)
)

function highlightKey(highlights: IntentHighlight[]): string {
    return highlights.map(highlight => `${highlight.id}:${highlight.state}:${highlight.reply ?? ''}`).join(',')
}

const REPLY_ICON: Record<IntentHighlight['state'], React.JSX.Element> = {
    recognized: <Loader className="size-3.5 animate-spin" aria-hidden />,
    running: <Loader className="size-3.5 animate-spin" aria-hidden />,
    done: <Check className="size-3.5" aria-hidden />,
    failed: <X className="size-3.5" aria-hidden />,
}

/** The assistant's answer under the words that asked: working, then what it did or found. */
function AssistantReply({ highlight }: { highlight: IntentHighlight }): React.JSX.Element {
    const working = highlight.state === 'running' || highlight.state === 'recognized'
    return (
        <p className={`transcript-reply transcript-reply-${highlight.state}`} role="status">
            {REPLY_ICON[highlight.state]}
            <span>
                {working ? 'Working…' : (highlight.reply ?? (highlight.state === 'done' ? 'Done' : 'That didn’t work'))}
            </span>
        </p>
    )
}

/** How long a request's state must hold before its colour changes. */
const HIGHLIGHT_SETTLE_MS = 200

/** The value once it has held still for a moment; the first value shows at once. */
function useSettled<T>(value: T, milliseconds: number): T {
    const [settled, setSettled] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), milliseconds)
        return () => clearTimeout(timer)
    }, [value, milliseconds])
    return settled
}

/** How long the lines take to glide up as a new one arrives at the bottom, and how they ease into place. */
const PUSH_UP_MS = 420
const PUSH_UP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

/**
 * The words as they're spoken, anchored to the bottom: each new word fades in on the last line, and when the text
 * grows the lines above glide up into place rather than jump. The text (only the text, not the glow behind it)
 * fades evenly from fully opaque on the last line to nothing at the top. The view follows the newest line unless
 * scrolled back. With nothing said yet, a placeholder sits where the first words will appear.
 */
export function LiveTranscript({ paragraphs, listening, preparing = false }: LiveTranscriptProps): React.JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [following, setFollowing] = useState(true)
    // A request's state settles for 200 ms before it shows, so quick steps (heard, working, done) read as one fade.
    const highlights = useSettled(intentHighlights.use(), HIGHLIGHT_SETTLE_MS)
    const partial = transcriptPartial.use()
    // Words still being heard go where they'll land: on the last line, or on a new paragraph of their own.
    const partialOwnParagraph = transcriptPartialNewParagraph.use() && partial !== '' && paragraphs.length > 0
    // The first words heard, and words heard on a line of their own, render as the paragraph they'll become.
    const pendingParagraph = partial !== '' && (paragraphs.length === 0 || partialOwnParagraph)
    const lastIndex = pendingParagraph ? -1 : paragraphs.length - 1
    const offsets: number[] = []
    paragraphs.reduce((start, text) => {
        offsets.push(start)
        return start + text.length + 1
    }, 0)

    const onScroll = useCallback(() => {
        const element = scrollRef.current
        if (!element) return
        const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
        setFollowing(distanceFromBottom < FOLLOW_THRESHOLD_PX)
    }, [])

    const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
        const element = scrollRef.current
        if (element) element.scrollTo({ top: element.scrollHeight, behavior })
    }, [])

    // Push-up: when the text grows, start it where it was and ease it into its new place.
    const contentRef = useRef<HTMLDivElement>(null)
    const lastHeight = useRef(0)
    useLayoutEffect(() => {
        if (following) scrollToLatest('auto')
        const content = contentRef.current
        if (!content) return
        const height = content.offsetHeight
        const grown = height - lastHeight.current
        lastHeight.current = height
        if (grown > 0 && grown < 200 && following && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            content.animate([{ transform: `translateY(${grown}px)` }, { transform: 'none' }], {
                duration: PUSH_UP_MS,
                easing: PUSH_UP_EASING,
            })
    }, [paragraphs, partial, highlights, following, scrollToLatest])

    useEffect(() => {
        const element = scrollRef.current
        if (!element) return
        const observer = new ResizeObserver(() => following && scrollToLatest('auto'))
        observer.observe(element)
        return () => observer.disconnect()
    }, [following, scrollToLatest])

    return (
        <div className="relative min-h-0 flex-1">
            <div
                ref={scrollRef}
                onScroll={onScroll}
                className="transcript-scroll selectable flex h-full flex-col overflow-y-auto px-5 pb-5"
                role="log"
                aria-live="polite"
                aria-label="Live transcript"
            >
                <div ref={contentRef} className="mt-auto">
                    {/* One keyed list, the paragraph still being heard included at the index it will have, so its
                        words keep their elements once confirmed. */}
                    {[...paragraphs, ...(pendingParagraph ? [''] : [])].map((text, index) => {
                        const pending = index === paragraphs.length
                        const offset = pending ? 0 : offsets[index]
                        const end = offset + text.length
                        return (
                            <Paragraph
                                key={index}
                                text={text}
                                latest={index >= paragraphs.length - 1}
                                offset={offset}
                                highlights={
                                    pending ? [] : highlights.filter(range => range.start < end && range.end > offset)
                                }
                                partial={pending || index === lastIndex ? partial : undefined}
                                caret={(pending || index === lastIndex) && listening}
                            />
                        )
                    })}
                    {paragraphs.length === 0 && !partial && (
                        <p className="transcript-paragraph">
                            {listening && <span className="transcript-caret" aria-hidden />}
                            <span className="transcript-placeholder">
                                {preparing ? 'Getting ready…' : 'Start talking. Your words appear here.'}
                            </span>
                        </p>
                    )}
                </div>
            </div>
            {!following && (
                <Button
                    size="xs"
                    variant="secondary"
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 shadow-lg"
                    onClick={() => {
                        setFollowing(true)
                        scrollToLatest('smooth')
                    }}
                >
                    <ArrowDown /> Latest
                </Button>
            )}
        </div>
    )
}
