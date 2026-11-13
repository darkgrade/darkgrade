import { NPM_INSTALL } from '@/app/components/site-links'

/** One thing asked of the camera, the call Link makes for it, and whether the camera has done it yet. */
export interface Exchange {
    id: number
    request: string
    call: string
    answered: boolean
}

/** How many exchanges the desk keeps: the chat shows the last few of them, the code all. */
export const EXCHANGES_KEPT = 5
const EXCHANGES_IN_CHAT = 4

/** The lines every Link program opens with, before the calls. */
const OPENING_LINES = [
    "import { Camera } from '@darkgrade/link'",
    '',
    'const camera = new Camera()',
    'await camera.connect()',
    '',
]

const PANE_HEAD =
    'flex h-[58px] shrink-0 items-center justify-between border-b border-hair px-8 font-mono text-[14px] tracking-[.2em] text-ink-52 uppercase'
/** Code is case-sensitive and the site's mono face is capitals only, so it is set in the system's. */
const CODE = '[font-family:ui-monospace,SFMono-Regular,Menlo,monospace]'
const CODE_ROW = 'grid h-[42px] grid-cols-[56px_minmax(0,1fr)_34px] items-center pr-5'

/** A line of code with its keywords dimmed and its strings in gold. */
function CodeLine({ line }: { line: string }) {
    return (
        <>
            {line.split(/(\bawait\b|\bconst\b|\bimport\b|\bfrom\b|\bnew\b|'[^']*')/).map((part, index) => {
                if (part.startsWith("'"))
                    return (
                        <span key={index} className="text-gold">
                            {part}
                        </span>
                    )
                if (/^(await|const|import|from|new)$/.test(part))
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
            className="desk-tick size-[20px] text-gold"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
    )
}

/** The agent's side of an exchange: three dots while the camera is being set, then its word that it is done. */
function Reply({ answered }: { answered: boolean }) {
    return (
        <li className="desk-arrive flex items-center gap-[14px] self-start">
            <span className="grid size-[38px] shrink-0 place-items-center rounded-full border border-gold/55 bg-gold/[.08] font-mono text-[18px] leading-none text-gold">
                +
            </span>
            {answered ? (
                <span className="desk-arrive flex items-center gap-[10px] text-[24px] text-ink">
                    Done
                    <Tick />
                </span>
            ) : (
                <span className="flex h-[38px] items-center gap-[7px]" aria-label="Working">
                    {[0, 1, 2].map(dot => (
                        <i
                            key={dot}
                            className="desk-dot size-[8px] rounded-full bg-ink-55"
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
 * the right the program Link is running, a call for each request, written as it is asked.
 */
export function LinkDesk({ exchanges }: { exchanges: Exchange[] }) {
    const newest = exchanges[exchanges.length - 1]
    return (
        <div className="flex h-full flex-col">
            <div className="grid min-h-0 flex-1 grid-cols-[.86fr_1fr]">
                <div className="flex min-h-0 flex-col border-r border-hair">
                    <div className={PANE_HEAD}>
                        <span>Ask the camera</span>
                        <span className="inline-flex items-center gap-[10px]">
                            <i className="size-[8px] rounded-full bg-gold shadow-[0_0_10px_rgba(244,198,110,.8)]" />
                            Connected
                        </span>
                    </div>
                    <ol className="flex min-h-0 flex-1 flex-col justify-end gap-[16px] overflow-hidden px-8 pb-5">
                        {exchanges.slice(-EXCHANGES_IN_CHAT).flatMap(exchange => [
                            <li
                                key={`request-${exchange.id}`}
                                className={`desk-arrive max-w-[86%] self-end rounded-[20px] rounded-br-[5px] px-[22px] py-[11px] text-[24px] leading-[1.25] ${exchange === newest ? 'bg-ink text-obsidian' : 'bg-ink/[.1] text-ink-66'}`}
                            >
                                {exchange.request}
                            </li>,
                            <Reply key={`reply-${exchange.id}`} answered={exchange.answered} />,
                        ])}
                    </ol>
                    <div className="mx-8 mb-6 flex h-[52px] shrink-0 items-center justify-between rounded-full border border-hair bg-ink/[.04] pr-[7px] pl-6 text-[20px] text-ink-52">
                        Say what you want
                        <span className="grid size-[38px] place-items-center rounded-full bg-gold text-obsidian">
                            <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="size-[18px]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.4"
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
                        <span className="flex h-full items-center border-b-2 border-gold text-ink">shoot.ts</span>
                        <span>
                            <span className="mr-3 text-gold">$</span>
                            {NPM_INSTALL}
                        </span>
                    </div>
                    <ol className={`flex min-h-0 flex-1 flex-col justify-end overflow-hidden pb-5 text-[21px] ${CODE}`}>
                        {OPENING_LINES.map((line, index) => (
                            <li key={`opening-${index}`} className={`${CODE_ROW} text-ink-66`}>
                                <span className="pr-4 text-right text-[16px] text-ink/25">{index + 1}</span>
                                <span className="truncate">
                                    <CodeLine line={line} />
                                </span>
                            </li>
                        ))}
                        {exchanges.map(exchange => (
                            <li
                                key={exchange.id}
                                className={`${CODE_ROW} ${exchange === newest ? 'desk-flash text-ink' : 'text-ink-66'}`}
                            >
                                <span className="pr-4 text-right text-[16px] text-ink/25">
                                    {OPENING_LINES.length + 1 + exchange.id}
                                </span>
                                <span className={`truncate ${exchange === newest ? 'desk-type' : ''}`}>
                                    <CodeLine line={exchange.call} />
                                </span>
                                {exchange.answered && <Tick />}
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    )
}
