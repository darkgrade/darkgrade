import { useEffect, useState } from 'react'

import { NPM_INSTALL } from '@/app/components/site-links'
import { ICON_PATHS, ICON_VIEWBOX } from '@/app/components/wordmark-paths'

/** One thing asked of the camera, the call Link makes for it, and whether the camera has done it yet. */
export interface Exchange {
    id: number
    request: string
    call: string
    answered: boolean
}

/** How many exchanges the desk keeps: the chat shows the last two of them, the code the last three. */
export const EXCHANGES_KEPT = 5
const EXCHANGES_IN_CHAT = 2
const CALLS_IN_CODE = 3

/** The lines every Link program opens with, before the calls. */
const OPENING_LINES = ['const camera = new Camera()', 'camera.connect()']

/** The words on the desk itself. */
const COPY = {
    ask: 'Ask the camera',
    connected: 'Connected',
    placeholder: 'Say what you want',
    done: 'Done',
    code: 'Or write code',
}

/* The desk is laid out 1280 pixels wide and then fitted to a laptop's screen a quarter of that across, so everything on it is set large. */
const PANE_HEAD =
    'flex h-[92px] shrink-0 items-center justify-between border-b border-hair px-10 font-mono text-[21px] tracking-[.08em] text-ink-52 uppercase'
const CODE_ROW = 'grid h-[70px] grid-cols-[minmax(0,1fr)_46px] items-center pr-7 pl-10 font-mono text-[29px]'

/** A line of code with its keywords dimmed and its strings in gold. */
function CodeLine({ line }: { line: string }) {
    return (
        <>
            {line.split(/(\bconst\b|\bnew\b|'[^']*')/).map((part, index) => {
                if (part.startsWith("'"))
                    return (
                        <span key={index} className="text-gold">
                            {part}
                        </span>
                    )
                if (/^(const|new)$/.test(part))
                    return (
                        <span key={index} className="text-ink-52">
                            {part}
                        </span>
                    )
                return part
            })}
        </>
    )
}

function Tick() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="desk-tick size-[30px] text-gold"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
    )
}

/** The agent's side of an exchange, under Darkgrade's own mark: three dots while the camera is being set, then its word that it is done. */
function Reply({ answered }: { answered: boolean }) {
    return (
        <li className="desk-arrive flex items-center gap-[18px] self-start">
            <svg
                viewBox={`0 0 ${ICON_VIEWBOX.width} ${ICON_VIEWBOX.height}`}
                aria-hidden="true"
                className="h-[31px] w-auto shrink-0 text-gold"
                fill="currentColor"
            >
                {ICON_PATHS.map(pathData => (
                    <path key={pathData} d={pathData} />
                ))}
            </svg>
            {answered ? (
                <span className="desk-arrive flex items-center gap-[12px] text-[31px] text-ink">
                    {COPY.done}
                    <Tick />
                </span>
            ) : (
                <span className="flex h-[50px] items-center gap-[10px]" aria-label="Working">
                    {[0, 1, 2].map(dot => (
                        <i
                            key={dot}
                            className="desk-dot size-[12px] rounded-full bg-ink-55"
                            style={{ animationDelay: `${dot * 0.14}s` }}
                        />
                    ))}
                </span>
            )}
        </li>
    )
}

/**
 * What runs on the laptop in the Link chapter, laid out for its screen and filling it: a chat on
 * the left where someone asks for what they want and an agent answers when it is done, and on
 * the right the program Link is running, a call for each request, written as it is asked. A
 * request is typed into the box at the foot of the chat, then sent up into it.
 */
/** How long a request takes to type, whatever its length, in milliseconds. */
const TYPING_MILLISECONDS = 620

/** As much of `text` as has been typed so far: it comes a letter at a time, or all at once for visitors who ask for reduced motion. */
function useTyped(text: string | null): string {
    const [letters, setLetters] = useState(0)
    useEffect(() => {
        if (!text) return
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setLetters(text.length)
            return
        }
        setLetters(0)
        const timer = window.setInterval(
            () => setLetters(typed => (typed >= text.length ? typed : typed + 1)),
            TYPING_MILLISECONDS / text.length
        )
        return () => window.clearInterval(timer)
    }, [text])
    return text ? text.slice(0, letters) : ''
}

interface LinkDeskProps {
    exchanges: Exchange[]
    /** The request being typed, before it is sent and becomes the newest exchange. */
    typing?: string | null
}

export function LinkDesk({ exchanges, typing = null }: LinkDeskProps) {
    const typed = useTyped(typing)
    const newest = exchanges[exchanges.length - 1]
    const calls = exchanges.slice(-CALLS_IN_CODE)
    return (
        <div className="grid h-full grid-cols-[.92fr_1fr]">
            <div className="flex min-h-0 flex-col border-r border-hair">
                <div className={PANE_HEAD}>
                    <span>{COPY.ask}</span>
                    <span className="inline-flex items-center gap-[12px] text-ink-66">
                        <i className="size-[12px] rounded-full bg-gold shadow-[0_0_14px_var(--glow)]" />
                        {COPY.connected}
                    </span>
                </div>
                <ol className="flex min-h-0 flex-1 flex-col justify-end gap-[22px] overflow-hidden px-10 pb-8">
                    {exchanges.slice(-EXCHANGES_IN_CHAT).flatMap(exchange => [
                        <li
                            key={`request-${exchange.id}`}
                            className={`${exchange === newest ? 'desk-send' : ''} max-w-[92%] self-end rounded-[30px] rounded-br-[8px] px-[30px] py-[16px] text-[33px] leading-[1.2] font-medium tracking-[-.02em] ${exchange === newest ? 'bg-ink text-obsidian' : 'bg-ink/[.1] text-ink-66'}`}
                        >
                            {exchange.request}
                        </li>,
                        <Reply key={`reply-${exchange.id}`} answered={exchange.answered} />,
                    ])}
                </ol>
                <div className="mx-10 mb-9 flex h-[82px] shrink-0 items-center justify-between rounded-full border border-hair bg-ink/[.04] pr-[11px] pl-9 text-[27px] text-ink-52">
                    {typing ? (
                        <span className="flex min-w-0 items-center text-ink">
                            <span className="truncate">{typed}</span>
                            <i className="desk-caret ml-[3px] h-[31px] w-[3px] shrink-0 bg-gold" />
                        </span>
                    ) : (
                        COPY.placeholder
                    )}
                    <span
                        className={`grid size-[60px] shrink-0 place-items-center rounded-full bg-gold text-obsidian transition-[scale,box-shadow] duration-300 ${typing && typed === typing ? 'scale-110 shadow-[0_0_26px_var(--glow)]' : ''}`}
                    >
                        <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            className="size-[28px]"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />
                        </svg>
                    </span>
                </div>
            </div>

            <div className="flex min-h-0 flex-col">
                <div className={PANE_HEAD}>
                    <span>{COPY.code}</span>
                    <span className="text-[18px] normal-case">
                        <span className="mr-3 text-gold">$</span>
                        {NPM_INSTALL}
                    </span>
                </div>
                <ol className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden pb-7">
                    {OPENING_LINES.map((line, index) => (
                        <li key={`opening-${index}`} className={`${CODE_ROW} text-ink-66`}>
                            <span className="truncate">
                                <CodeLine line={line} />
                            </span>
                        </li>
                    ))}
                    {calls.map(exchange => (
                        <li
                            key={exchange.id}
                            className={`${CODE_ROW} ${exchange === newest ? 'desk-flash text-ink' : 'text-ink-66'}`}
                        >
                            <span className={`truncate ${exchange === newest ? 'desk-type' : ''}`}>
                                <CodeLine line={exchange.call} />
                            </span>
                            {exchange.answered && <Tick />}
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    )
}
