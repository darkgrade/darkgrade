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

function splitWords(text: string): string[] {
    return text.match(/\s*\S+/g) ?? []
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

/** One paragraph; requests heard in it are coloured by how far the assistant has got with them. */
const Paragraph = memo(
    function Paragraph({ text, offset, highlights, partial, caret }: ParagraphProps) {
        // Consecutive words of one request become one highlighted run, so a command reads as one block.
        const runs: {
            highlight: IntentHighlight | undefined
            words: { key: number; leading: string; word: string }[]
        }[] = []
        let position = offset
        splitWords(text).forEach((word, index) => {
            const leadingLength = word.length - word.trimStart().length
            const wordStart = position + leadingLength
            const wordEnd = position + word.length
            position = wordEnd
            const highlight = highlights.find(range => range.start < wordEnd && range.end > wordStart)
            const entry = { key: index, leading: word.slice(0, leadingLength), word: word.slice(leadingLength) }
            const last = runs.at(-1)
            if (last && last.highlight === highlight && highlight) last.words.push(entry)
            else runs.push({ highlight, words: [entry] })
        })
        const answered = highlights.filter(highlight => highlight.state !== 'recognized')
        return (
            <>
                <p className="transcript-paragraph">
                    {runs.map(run => {
                        if (!run.highlight) {
                            return run.words.map(entry => (
                                <span key={entry.key} className="transcript-word">
                                    {entry.leading + entry.word}
                                </span>
                            ))
                        }
                        const [first, ...rest] = run.words
                        return (
                            <span key={first.key}>
                                {first.leading}
                                <span
                                    className={HIGHLIGHT_CLASS[run.highlight.state]}
                                    title={run.highlight.reply ?? undefined}
                                >
                                    <span className="transcript-word">{first.word}</span>
                                    {rest.map(entry => (
                                        <span key={entry.key} className="transcript-word">
                                            {entry.leading + entry.word}
                                        </span>
                                    ))}
                                </span>
                            </span>
                        )
                    })}
                    {partial && (
                        <span className="text-muted-foreground">
                            {/\s$/.test(text) || /^\s/.test(partial) ? '' : ' '}
                            {partial}{' '}
                        </span>
                    )}
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
    const highlights = intentHighlights.use()
    const partial = transcriptPartial.use()
    // Words still being heard go where they'll land: on the last line, or on a new paragraph of their own.
    const partialOwnParagraph = transcriptPartialNewParagraph.use() && partial !== '' && paragraphs.length > 0
    const lastIndex = partialOwnParagraph ? -1 : paragraphs.length - 1
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
                    {paragraphs.map((text, index) => {
                        const offset = offsets[index]
                        const end = offset + text.length
                        return (
                            <Paragraph
                                key={index}
                                text={text}
                                latest={index === paragraphs.length - 1}
                                offset={offset}
                                highlights={highlights.filter(range => range.start < end && range.end > offset)}
                                partial={index === lastIndex ? partial : undefined}
                                caret={index === lastIndex && listening}
                            />
                        )
                    })}
                    {(paragraphs.length === 0 || partialOwnParagraph) && (
                        <p className="transcript-paragraph">
                            {partial && <span className="text-muted-foreground">{partial} </span>}
                            {listening && <span className="transcript-caret" aria-hidden />}
                            {!partial && paragraphs.length === 0 && (
                                <span className="transcript-placeholder">
                                    {preparing ? 'Getting ready…' : 'Start talking. Your words appear here.'}
                                </span>
                            )}
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
