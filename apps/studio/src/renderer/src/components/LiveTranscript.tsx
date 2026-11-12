import { Button } from '@kevinschaich/components'
import { intentHighlights, transcriptPartial, type IntentHighlight } from '@voice/transcript-store'
import { ArrowDown, Check, Loader, X } from 'lucide-react'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

interface LiveTranscriptProps {
    paragraphs: string[]
    listening: boolean
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
}

/** One paragraph; requests heard in it are coloured by how far the assistant has got with them. */
const Paragraph = memo(
    function Paragraph({ text, latest, offset, highlights }: ParagraphProps) {
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
                <p className={`transcript-paragraph ${latest ? 'text-foreground' : 'text-foreground/55'}`}>
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

/** The words as they're spoken: each fades in, and the view follows the newest line unless scrolled back. */
export function LiveTranscript({ paragraphs, listening }: LiveTranscriptProps): React.JSX.Element {
    const scrollRef = useRef<HTMLDivElement>(null)
    const [following, setFollowing] = useState(true)
    const highlights = intentHighlights.use()
    const partial = transcriptPartial.use()
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

    useLayoutEffect(() => {
        if (following) scrollToLatest('auto')
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
                className="selectable h-full overflow-y-auto px-5 pt-3 pb-5"
                role="log"
                aria-live="polite"
                aria-label="Live transcript"
            >
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
                        />
                    )
                })}
                {partial && <span className="text-muted-foreground">{partial} </span>}
                {listening && <span className="transcript-caret" aria-hidden />}
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
