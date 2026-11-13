'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'

import { watch } from '@/app/components/home/motion'

/** One clip on the page's timeline: a run of the page's sections under one name. */
export interface TimelineClip {
    id: string
    label: string
    /** The ids of the sections it covers, in page order; a click scrolls to the first. */
    sections: string[]
    /** What the audio under it sounds like: someone talking, a busy room, or a quiet one. */
    sound: 'speech' | 'room' | 'quiet'
}

interface PageTimelineProps {
    clips: TimelineClip[]
    /** The page's sections by id, filled in by the page as they mount. */
    sections: RefObject<Map<string, HTMLElement>>
}

const FRAMES_PER_SECOND = 24
/** How long the page's timeline pretends the footage runs, end to end: illustrative, as the takes on the first cut are. */
const RUNTIME_SECONDS = 150
/** How many bars of waveform the whole timeline is drawn with; a clip gets its share. */
const BARS_ACROSS = 560
const TWO_DIGITS = (value: number) => String(Math.floor(value)).padStart(2, '0')

function timecode(seconds: number): string {
    return `00:${TWO_DIGITS(seconds / 60)}:${TWO_DIGITS(seconds % 60)}:${TWO_DIGITS((seconds % 1) * FRAMES_PER_SECOND)}`
}

/** A number from 0 to 1 that is the same for the same two numbers, wherever it is worked out. */
function scattered(index: number, seed: number): number {
    const mixed = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453
    return mixed - Math.floor(mixed)
}

/** How loud each kind of sound runs, how much it falls away between phrases, and how much it jumps from bar to bar. */
const SOUNDS = {
    speech: { level: 0.92, floor: 0.14, phrases: 0.62, jitter: 0.5 },
    room: { level: 0.52, floor: 0.12, phrases: 0.35, jitter: 0.5 },
    quiet: { level: 0.2, floor: 0.06, phrases: 0.2, jitter: 0.6 },
}

/**
 * Bar heights for a drawn waveform, 0..1. Speech comes in phrases with gaps between them and
 * syllables inside them; a room is steadier and lower. The same every render, so the server and
 * the browser agree.
 */
function waveform(bars: number, seed: number, sound: TimelineClip['sound']): number[] {
    const { level, floor, phrases, jitter } = SOUNDS[sound]
    return Array.from({ length: bars }, (_, index) => {
        const phrase = Math.max(
            0,
            Math.sin(index * 0.23 + seed * 1.7) * 0.6 + Math.sin(index * 0.071 + seed) * 0.4 + 0.72
        )
        const syllable = 0.45 + 0.55 * Math.abs(Math.sin(index * 0.83 + seed * 2.3))
        const loud =
            (1 - phrases + phrases * Math.min(1, phrase)) * syllable * (1 - jitter + jitter * scattered(index, seed))
        // Rounded, so the markup is the same digit for digit wherever it is rendered.
        return Math.round(Math.min(1, floor + level * loud) * 100) / 100
    })
}

function Waveform({ bars, seed, sound }: { bars: number; seed: number; sound: TimelineClip['sound'] }) {
    return (
        <svg
            viewBox={`0 0 ${bars * 2} 20`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="block h-full w-full"
        >
            {waveform(bars, seed, sound).map((height, index) => (
                <rect
                    key={index}
                    x={index * 2}
                    y={(10 - height * 9.5).toFixed(2)}
                    width="1.1"
                    height={(height * 19).toFixed(2)}
                    fill="currentColor"
                />
            ))}
        </svg>
    )
}

/** How far down the page the reading line is, 0..1: it runs from the top of the window to its bottom as the page scrolls through. */
function readingLine(): number {
    const scroller = document.scrollingElement
    if (!scroller) return 0
    const furthest = scroller.scrollHeight - innerHeight
    if (furthest <= 0) return 0
    const through = Math.min(1, Math.max(0, scroller.scrollTop / furthest))
    return (scroller.scrollTop + innerHeight * through) / scroller.scrollHeight
}

const TRACK_NAME = 'flex items-center font-mono text-[9px] tracking-[.14em] text-ink-52 uppercase'

/**
 * The strip docked to the bottom of the window: the page as an editor's timeline, after The
 * Set's. Each clip is a chapter with its audio drawn under it, the playhead and timecode follow
 * the scroll, and a click on a clip goes to it. It starts below the first fold and comes up as
 * the page is scrolled (`--drop`), and rides up on the footer at the end (`--lift`).
 */
export function PageTimeline({ clips, sections }: PageTimelineProps) {
    const playhead = useRef<HTMLDivElement>(null)
    const clock = useRef<HTMLSpanElement>(null)
    const [shares, setShares] = useState<number[]>(() => clips.map(() => 1 / clips.length))
    const [active, setActive] = useState(0)
    const sharesNow = useRef(shares)
    sharesNow.current = shares

    useEffect(() => {
        const scroller = document.scrollingElement
        if (!scroller) return
        function measure() {
            const total = scroller!.scrollHeight
            const ends = clips.map(clip => {
                const last = sections.current.get(clip.sections[clip.sections.length - 1])
                return last ? last.getBoundingClientRect().bottom + scroller!.scrollTop : 0
            })
            // The last clip also takes whatever follows the last section, so the clips add up to the whole page.
            ends[ends.length - 1] = total
            setShares(ends.map((end, index) => (end - (index === 0 ? 0 : ends[index - 1])) / total))
        }
        measure()
        const resized = new ResizeObserver(measure)
        resized.observe(document.body)
        return () => resized.disconnect()
    }, [clips, sections])

    useEffect(
        () =>
            watch(readingLine, line => {
                if (playhead.current) playhead.current.style.left = `${(line * 100).toFixed(3)}%`
                if (clock.current) clock.current.textContent = timecode(line * RUNTIME_SECONDS)
                let passed = 0
                const index = sharesNow.current.findIndex(share => (passed += share) >= line)
                setActive(index === -1 ? sharesNow.current.length - 1 : index)
            }),
        []
    )

    function goTo(clip: TimelineClip) {
        const section = sections.current.get(clip.sections[0])
        if (!section) return
        const bounds = section.getBoundingClientRect()
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        scrollTo({
            top: scrollY + bounds.top + Math.max(0, (bounds.height - innerHeight) / 2),
            behavior: reduced ? 'instant' : 'smooth',
        })
    }

    let startsAt = 0
    return (
        <div className="fixed inset-x-0 bottom-0 z-[70] [translate:0_calc(var(--drop,var(--timeline-h))-var(--lift,0px))] border-t border-hair bg-[rgba(9,9,10,.9)] backdrop-blur-[14px]">
            <nav
                aria-label="Chapters"
                className="grid h-[var(--timeline-h)] grid-cols-[clamp(132px,13vw,188px)_minmax(0,1fr)] max-[900px]:grid-cols-[112px_minmax(0,1fr)]"
            >
                {/* top-aligned: the bottom left corner of the window is where a dev build's badge sits */}
                <div className="flex flex-col gap-[7px] border-r border-hair px-[clamp(12px,1.4vw,20px)] pt-[14px]">
                    <span
                        ref={clock}
                        className="glow-sm font-mono text-[clamp(.875rem,1.25vw,1.125rem)] leading-none tracking-[.06em] tabular-nums"
                    >
                        {timecode(0)}
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[9px] tracking-[.2em] text-ink-52 uppercase">
                        <i className="size-[6px] rounded-full bg-rec opacity-[calc(.25_+_.75_*_var(--rolling))] shadow-[0_0_8px_rgba(224,72,62,.7)]" />
                        <span className="max-[900px]:hidden">Seq 01 · 24 fps</span>
                        <span className="hidden truncate text-gold max-[900px]:inline">{clips[active]?.label}</span>
                    </span>
                </div>

                <div className="relative grid grid-cols-[20px_minmax(0,1fr)] grid-rows-[16px_minmax(0,1fr)_30px] gap-x-[6px] gap-y-[4px] px-3 py-[8px] max-[900px]:px-2">
                    <span />
                    <div className="relative flex border-b border-hair">
                        {clips.map((clip, index) => {
                            const label = timecode(startsAt * RUNTIME_SECONDS).slice(3)
                            startsAt += shares[index]
                            return (
                                <span
                                    key={clip.id}
                                    className="relative overflow-hidden border-l border-ink/30 pl-[5px] font-mono text-[9px] leading-[12px] tracking-[.08em] text-ink-52 tabular-nums"
                                    style={{ width: `${shares[index] * 100}%` }}
                                >
                                    <span className="max-[900px]:hidden">{label}</span>
                                </span>
                            )
                        })}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[4px] bg-[repeating-linear-gradient(to_right,rgba(234,230,220,.28)_0_1px,transparent_1px_1.25%)]" />
                    </div>

                    <span className={TRACK_NAME}>V1</span>
                    <div className="flex min-h-0 gap-[3px]">
                        {clips.map((clip, index) => (
                            <button
                                key={clip.id}
                                type="button"
                                onClick={() => goTo(clip)}
                                aria-current={index === active ? 'step' : undefined}
                                aria-label={clip.label}
                                className={`relative min-w-0 cursor-pointer overflow-hidden rounded-[4px] border px-[7px] text-left transition-[background,border-color,color] duration-300 ${
                                    index === active
                                        ? 'border-gold/70 bg-[linear-gradient(rgba(246,221,168,.22),rgba(246,221,168,.08))] text-gold'
                                        : 'border-ink/15 bg-ink/[.045] text-ink-55 hover:border-ink/40 hover:text-ink'
                                }`}
                                style={{ width: `${shares[index] * 100}%` }}
                            >
                                <span className="block truncate font-mono text-[10px] leading-[1.5] tracking-[.1em] uppercase max-[1200px]:text-[9px] max-[1200px]:tracking-[.04em] max-[900px]:hidden">
                                    {clip.label}
                                </span>
                            </button>
                        ))}
                    </div>

                    <span className={TRACK_NAME}>A1</span>
                    <div className="flex min-h-0 gap-[3px]" aria-hidden="true">
                        {clips.map((clip, index) => (
                            <span
                                key={clip.id}
                                className={`min-w-0 overflow-hidden rounded-[4px] border transition-colors duration-300 ${index === active ? 'border-gold/35 bg-gold/[.06] text-gold/75' : 'border-ink/12 bg-ink/[.035] text-ink/45'}`}
                                style={{ width: `${shares[index] * 100}%` }}
                            >
                                <Waveform
                                    bars={Math.max(12, Math.round(shares[index] * BARS_ACROSS))}
                                    seed={index * 2.3 + 0.4}
                                    sound={clip.sound}
                                />
                            </span>
                        ))}
                    </div>

                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-3 left-[38px] max-[900px]:right-2 max-[900px]:left-[34px]"
                    >
                        <div
                            ref={playhead}
                            className="absolute inset-y-0 w-px bg-gold shadow-[0_0_10px_rgba(244,198,110,.9)]"
                        >
                            <span className="absolute top-0 left-1/2 h-[9px] w-[11px] -translate-x-1/2 bg-gold [clip-path:polygon(0_0,100%_0,100%_45%,50%_100%,0_45%)]" />
                        </div>
                    </div>
                </div>
            </nav>
        </div>
    )
}
