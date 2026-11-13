import { MARK_NEXT } from '@/app/components/site-links'

/** Bar heights for a drawn waveform, 0..1: the same every render, so the server and the browser agree. */
function waveform(bars: number, seed: number, loudness: number): number[] {
    return Array.from({ length: bars }, (_, index) => {
        const swell = Math.abs(Math.sin(index * 0.37 + seed)) * Math.abs(Math.sin(index * 1.93 + seed * 2.1))
        return (
            Math.round(Math.min(1, 0.12 + swell * loudness + Math.abs(Math.sin(index * 5.1 + seed)) * 0.12) * 100) / 100
        )
    })
}

function Waveform({ bars, seed, loudness }: { bars: number; seed: number; loudness: number }) {
    return (
        <svg
            viewBox={`0 0 ${bars * 3} 20`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="block h-full w-full"
        >
            {waveform(bars, seed, loudness).map((height, index) => (
                <rect
                    key={index}
                    x={index * 3}
                    y={(10 - height * 9).toFixed(2)}
                    width="1.6"
                    height={(height * 18).toFixed(2)}
                    fill="currentColor"
                />
            ))}
        </svg>
    )
}

/** The takes of the first cut, in seconds: when each was shot, how long it ran, and how much of it the cut keeps. Illustrative. */
const TAKES = [
    { shotAt: 0, ran: 13, keep: 8 },
    { shotAt: 16, ran: 9, keep: 7 },
    { shotAt: 28, ran: 15, keep: 9 },
    { shotAt: 46, ran: 7, keep: 6 },
    { shotAt: 56, ran: 12, keep: 8.5 },
    { shotAt: 71, ran: 10, keep: 6 },
    { shotAt: 84, ran: 14, keep: 10 },
]
const SHOT_SECONDS = 100
const CUT_STARTS = TAKES.map((_, index) => TAKES.slice(0, index).reduce((total, take) => total + take.keep, 0))
const CUT_SECONDS = CUT_STARTS[TAKES.length - 1] + TAKES[TAKES.length - 1].keep
const percent = (seconds: number) => `${((seconds / SHOT_SECONDS) * 100).toFixed(3)}%`

/** Where the titles sit over the finished cut, in seconds. */
const TITLES = [
    { label: 'Title', from: 0.6, to: 7 },
    { label: 'Lower third', from: 8, to: 20 },
    { label: 'Captions', from: 21, to: CUT_SECONDS - 1.5 },
]

/** The words on the first cut's screen. */
const COPY = {
    app: 'Darkgrade Studio',
    sequence: 'Seq 01 · 24 fps',
    status: 'On the way',
    title: 'First cut',
    take: 'Take',
    titles: ['Title', 'Lower third', 'Captions'],
}

const LANE = 'relative h-full rounded-[5px] bg-white/[.03]'
const LANE_NAME = 'flex items-center font-mono text-[13px] tracking-[.06em] text-ink-52 uppercase'

/** The classes and custom properties here are home.css's: a take slides from where it was shot to where the cut puts it as `--cut` rises. */
function takeStyle(index: number): React.CSSProperties {
    const take = TAKES[index]
    return {
        '--raw-left': percent(take.shotAt),
        '--raw-width': percent(take.ran),
        '--cut-left': percent(CUT_STARTS[index]),
        '--cut-width': percent(take.keep),
    } as React.CSSProperties
}

/** What runs on the laptop in the studio: the first cut assembling itself, laid out for the laptop's screen. */
export function FirstCutApp({ feature }: { feature: string }) {
    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-hair px-7 py-[14px] font-mono text-[13px] tracking-[.08em] text-ink-52 uppercase">
                <span className="flex items-center gap-3">
                    <span className="flex gap-[7px]">
                        <i className="size-[10px] rounded-full bg-ink/25" />
                        <i className="size-[10px] rounded-full bg-ink/25" />
                        <i className="size-[10px] rounded-full bg-ink/25" />
                    </span>
                    <span className="ml-3 text-ink-66">{COPY.app}</span>
                </span>
                <span>{COPY.sequence}</span>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
                <div className="flex flex-col justify-center gap-5 border-r border-hair px-8">
                    <span className="inline-flex items-center gap-[11px] font-mono text-[13px] tracking-[.08em] text-ink-66 uppercase">
                        <i className={MARK_NEXT} />
                        {COPY.status}
                    </span>
                    <span className="font-serif text-[3.5rem] leading-none heading-weight tracking-[-.045em] text-ink">
                        {COPY.title}
                    </span>
                    <span className="max-w-[22ch] text-[17px] leading-[1.5] text-ink-66">{feature}</span>
                </div>
                <div className="relative grid min-h-0 grid-cols-[44px_minmax(0,1fr)] grid-rows-[26px_0.7fr_1.3fr_1fr_0.7fr] gap-x-3 gap-y-[9px] px-6 py-6">
                    <span />
                    <div className="border-b border-hair bg-[repeating-linear-gradient(to_right,rgba(234,230,220,.3)_0_1px,transparent_1px_2%)] [background-size:100%_7px] bg-bottom bg-no-repeat" />
                    {/* over the lanes, inside the grid's padding and past the lane names */}
                    <div className="pointer-events-none absolute top-6 right-6 bottom-6 left-[80px] z-10">
                        <span
                            className="cut-playhead absolute inset-y-0 w-[2px] bg-gold shadow-[0_0_10px_var(--glow)]"
                            style={{ '--cut-length': percent(CUT_SECONDS) } as React.CSSProperties}
                        />
                    </div>

                    <span className={LANE_NAME}>T1</span>
                    <div className={LANE}>
                        {TITLES.map((title, index) => (
                            <span
                                key={title.label}
                                className="cut-title absolute inset-y-0 flex items-center overflow-hidden rounded-[5px] border border-ink/25 bg-ink/[.08] px-[7px] font-mono text-[11px] tracking-[.04em] whitespace-nowrap text-ink-66 uppercase"
                                style={{ left: percent(title.from), width: percent(title.to - title.from) }}
                            >
                                {COPY.titles[index]}
                            </span>
                        ))}
                    </div>

                    <span className={LANE_NAME}>V1</span>
                    <div className={LANE}>
                        {TAKES.map((take, index) => (
                            <span
                                key={take.shotAt}
                                className="cut-take absolute inset-y-0 flex items-start overflow-hidden rounded-[5px] border border-gold/55 bg-[linear-gradient(color-mix(in_srgb,var(--color-gold)_20%,transparent),color-mix(in_srgb,var(--color-gold)_7%,transparent))] px-[7px] pt-[7px] font-mono text-[11px] tracking-[.04em] whitespace-nowrap text-gold uppercase"
                                style={takeStyle(index)}
                            >
                                {COPY.take} {index + 1}
                            </span>
                        ))}
                    </div>

                    <span className={LANE_NAME}>A1</span>
                    <div className={LANE}>
                        {TAKES.map((take, index) => (
                            <span
                                key={take.shotAt}
                                className="cut-take absolute inset-y-0 overflow-hidden rounded-[5px] border border-ink/20 bg-ink/[.05] text-ink/55"
                                style={takeStyle(index)}
                            >
                                <Waveform bars={42} seed={index * 1.7 + 1} loudness={1.5} />
                            </span>
                        ))}
                    </div>

                    <span className={LANE_NAME}>M1</span>
                    <div className={LANE}>
                        <span
                            className="cut-music absolute inset-y-0 left-0 overflow-hidden rounded-[5px] border border-ink/15 bg-ink/[.035] text-ink/35"
                            style={{ width: percent(CUT_SECONDS) }}
                        >
                            <Waveform bars={150} seed={9} loudness={0.7} />
                        </span>
                    </div>
                </div>
            </div>
        </div>
    )
}
