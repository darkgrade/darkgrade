'use client'

import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react'

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

/** How far the page can be scrolled, in pixels. */
function furthestScroll(): number {
    const scroller = document.scrollingElement
    return scroller ? Math.max(0, scroller.scrollHeight - innerHeight) : 0
}

/** Puts the reading line a share of the way down the page, at once: the line is as far down the page as the page is scrolled through. */
function putReadingLineAt(line: number) {
    scrollTo({ top: Math.min(1, Math.max(0, line)) * furthestScroll(), behavior: 'instant' })
}

/** A clip narrower than this share of the page has no room for its timecode on the ruler. */
const NARROWEST_SHARE_WITH_A_TIMECODE = 0.075
/** How far the pointer has to move over a clip before it is scrubbing the timeline and not choosing the clip, in pixels. */
const DRAG_STARTS_AFTER_PIXELS = 4
/** The keys that scroll a page: any of them takes over from the playback. */
const SCROLLING_KEYS = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']
/** How far the page may sit from where the playback put it before something else is taken to have moved it, in pixels. */
const MOVED_BY_SOMETHING_ELSE_PIXELS = 2
/** The longest step the playback takes in one frame, in seconds: a window left and come back to carries on, it does not jump. */
const LONGEST_FRAME_SECONDS = 0.1

function TransportIcon({ playing }: { playing: boolean }) {
    return (
        <svg viewBox="0 0 12 12" aria-hidden="true" className="size-[9px]" fill="currentColor">
            {playing ? <path d="M2 1.5h3v9H2zM7 1.5h3v9H7z" /> : <path d="M2.5 1.2v9.6L11 6z" />}
        </svg>
    )
}

/**
 * The strip docked to the bottom of the window: the page as an editor's timeline. Each clip is a
 * chapter with its sound drawn through it, the playhead and timecode follow the scroll, the
 * clips already played stay lit a little, and a click on a clip goes to it. Dragging along the
 * ruler or the clips scrubs the page, and the play button runs it through at the timecode's own
 * pace, from where it is to the end. It starts below the first fold and comes up as the page is
 * scrolled (`--drop`), and rides up on the footer at the end (`--lift`).
 */
export function PageTimeline({ clips, sections }: PageTimelineProps) {
    const playhead = useRef<HTMLDivElement>(null)
    const clock = useRef<HTMLSpanElement>(null)
    const [shares, setShares] = useState<number[]>(() => clips.map(() => 1 / clips.length))
    const [active, setActive] = useState(0)
    const sharesNow = useRef(shares)
    sharesNow.current = shares
    const track = useRef<HTMLDivElement>(null)
    const [playing, setPlaying] = useState(false)
    const playingNow = useRef(playing)
    playingNow.current = playing
    const [scrubbing, setScrubbing] = useState(false)
    /** The press under way on the track: where it began, and whether it has become a drag. */
    const press = useRef<{ startX: number; dragging: boolean } | null>(null)
    const draggedSincePress = useRef(false)

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

    useEffect(() => {
        const scroller = document.scrollingElement
        if (!playing || !scroller) return
        // Played from the end, it starts again from the top.
        let line = readingLine() >= 0.999 ? 0 : readingLine()
        let putAt = line * furthestScroll()
        putReadingLineAt(line)
        let before = performance.now()
        let animationFrame = requestAnimationFrame(function advance(now) {
            const furthest = furthestScroll()
            // Scrubbing, or choosing a clip, moves the page under the playback: it carries on from there.
            if (Math.abs(scroller.scrollTop - putAt) > MOVED_BY_SOMETHING_ELSE_PIXELS)
                line = furthest > 0 ? scroller.scrollTop / furthest : 1
            line = Math.min(1, line + Math.min(LONGEST_FRAME_SECONDS, (now - before) / 1000) / RUNTIME_SECONDS)
            before = now
            putAt = line * furthest
            putReadingLineAt(line)
            if (line >= 1) setPlaying(false)
            else animationFrame = requestAnimationFrame(advance)
        })
        // Whoever scrolls the page themselves has taken over.
        const pause = () => setPlaying(false)
        const pauseUnlessOnTheTrack = (event: TouchEvent) => {
            if (!(event.target instanceof Node && track.current?.contains(event.target))) pause()
        }
        const pauseOnAScrollingKey = (event: KeyboardEvent) => {
            if (SCROLLING_KEYS.includes(event.key) && !(event.target instanceof HTMLButtonElement)) pause()
        }
        addEventListener('wheel', pause, { passive: true })
        addEventListener('touchmove', pauseUnlessOnTheTrack, { passive: true })
        addEventListener('keydown', pauseOnAScrollingKey)
        return () => {
            cancelAnimationFrame(animationFrame)
            removeEventListener('wheel', pause)
            removeEventListener('touchmove', pauseUnlessOnTheTrack)
            removeEventListener('keydown', pauseOnAScrollingKey)
        }
    }, [playing])

    function goTo(clip: TimelineClip) {
        const section = sections.current.get(clip.sections[0])
        if (!section) return
        const bounds = section.getBoundingClientRect()
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        scrollTo({
            top: scrollY + bounds.top + Math.max(0, (bounds.height - innerHeight) / 2),
            // While it plays the page is being put somewhere every frame, and a glide would be cut short.
            behavior: reduced || playingNow.current ? 'instant' : 'smooth',
        })
    }

    function scrubTo(clientX: number) {
        const bounds = track.current?.getBoundingClientRect()
        if (bounds) putReadingLineAt((clientX - bounds.left) / bounds.width)
    }

    function startDragging(event: PointerEvent<HTMLDivElement>) {
        if (!press.current) return
        press.current.dragging = true
        draggedSincePress.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        setScrubbing(true)
    }

    /** A press on the ruler scrubs at once; a press on a clip scrubs only once it is dragged, so a click still chooses the clip. */
    function onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0) return
        press.current = { startX: event.clientX, dragging: false }
        draggedSincePress.current = false
        if (event.target instanceof Element && event.target.closest('button')) return
        startDragging(event)
        scrubTo(event.clientX)
    }

    function onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const pressed = press.current
        if (!pressed) return
        if (!pressed.dragging && Math.abs(event.clientX - pressed.startX) < DRAG_STARTS_AFTER_PIXELS) return
        if (!pressed.dragging) startDragging(event)
        scrubTo(event.clientX)
    }

    function onPointerEnd() {
        press.current = null
        setScrubbing(false)
    }

    let startsAt = 0
    return (
        <div className="fixed inset-x-0 bottom-0 z-[70] [translate:0_calc(var(--drop,var(--timeline-h))-var(--lift,0px))] border-t border-hair bg-[rgba(9,9,10,.82)] backdrop-blur-[18px]">
            <nav
                aria-label="Chapters"
                className="shell grid h-[var(--timeline-h)] grid-cols-[auto_minmax(0,1fr)] items-stretch gap-x-[clamp(14px,2vw,28px)] select-none"
            >
                <div className="flex flex-col gap-[5px] pt-[10px] max-[900px]:w-[92px] max-[900px]:pt-[7px]">
                    <span
                        ref={clock}
                        className="glow-sm font-mono text-[15px] leading-none tracking-[.02em] tabular-nums"
                    >
                        {timecode(0)}
                    </span>
                    <span className="flex items-center gap-[7px] font-mono text-[10px] leading-none tracking-[.08em] text-ink-52 uppercase">
                        <i className="size-[6px] shrink-0 rounded-full bg-rec opacity-[calc(.3_+_.7_*_var(--rolling))] shadow-[0_0_8px_rgba(224,72,62,.7)]" />
                        <span className="truncate">{clips[active]?.label}</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => setPlaying(now => !now)}
                        aria-pressed={playing}
                        className={`mt-[6px] inline-flex h-[24px] cursor-pointer items-center gap-[7px] self-start rounded-full border pr-[11px] pl-[9px] font-mono text-[10px] leading-none tracking-[.08em] uppercase transition-[background,border-color,color] duration-300 max-[900px]:mt-[2px] max-[900px]:h-[20px] ${playing ? 'border-gold/70 bg-gold/[.14] text-gold' : 'border-ink/20 text-ink-62 hover:border-ink/45 hover:text-ink'}`}
                    >
                        <TransportIcon playing={playing} />
                        {playing ? 'Pause' : 'Play'}
                    </button>
                </div>

                <div
                    ref={track}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerEnd}
                    onPointerCancel={onPointerEnd}
                    onClickCapture={event => {
                        // The click that ends a drag across a clip does not choose that clip.
                        if (draggedSincePress.current) event.stopPropagation()
                    }}
                    className={`relative grid touch-pan-y grid-rows-[13px_minmax(0,1fr)] gap-y-[5px] py-[10px] ${scrubbing ? 'cursor-ew-resize [&_button]:cursor-ew-resize' : 'cursor-ew-resize'}`}
                >
                    <div className="relative flex" aria-hidden="true">
                        {clips.map((clip, index) => {
                            const label = timecode(startsAt * RUNTIME_SECONDS).slice(3, 8)
                            startsAt += shares[index]
                            return (
                                <span
                                    key={clip.id}
                                    className="relative border-l border-ink/25 pl-[5px] font-mono text-[9px] leading-[10px] text-ink-52 tabular-nums"
                                    style={{ width: `${shares[index] * 100}%` }}
                                >
                                    {shares[index] >= NARROWEST_SHARE_WITH_A_TIMECODE && (
                                        <span className="max-[900px]:hidden">{label}</span>
                                    )}
                                </span>
                            )
                        })}
                        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-[repeating-linear-gradient(to_right,rgba(234,230,220,.22)_0_1px,transparent_1px_1.25%)]" />
                    </div>

                    <div className="flex min-h-0 gap-[3px]">
                        {clips.map((clip, index) => {
                            const state = index === active ? 'now' : index < active ? 'played' : 'ahead'
                            return (
                                <button
                                    key={clip.id}
                                    type="button"
                                    onClick={() => goTo(clip)}
                                    aria-current={index === active ? 'step' : undefined}
                                    aria-label={clip.label}
                                    className={`group relative min-w-0 cursor-pointer overflow-hidden rounded-[5px] border text-left transition-[background,border-color,color] duration-300 ${CLIP[state]}`}
                                    style={{ width: `${shares[index] * 100}%` }}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`absolute inset-x-0 bottom-[3px] h-[38%] transition-opacity duration-300 ${state === 'now' ? 'opacity-70' : 'opacity-35 group-hover:opacity-60'}`}
                                    >
                                        <Waveform
                                            bars={Math.max(12, Math.round(shares[index] * BARS_ACROSS))}
                                            seed={index * 2.3 + 0.4}
                                            sound={clip.sound}
                                        />
                                    </span>
                                    <span className="absolute top-[8px] right-[8px] left-[8px] truncate font-mono text-[10px] leading-none tracking-[.06em] uppercase max-[900px]:hidden">
                                        {clip.label}
                                    </span>
                                </button>
                            )
                        })}
                    </div>

                    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                        <div
                            ref={playhead}
                            className="absolute inset-y-[6px] w-px bg-gold shadow-[0_0_8px_var(--glow),0_0_22px_rgba(255,110,48,.55)]"
                        >
                            <span className="absolute top-0 left-1/2 h-[8px] w-[9px] -translate-x-1/2 bg-gold [clip-path:polygon(0_0,100%_0,100%_45%,50%_100%,0_45%)]" />
                        </div>
                    </div>
                </div>
            </nav>
        </div>
    )
}

/** How a clip is drawn: the one being read, those already read, and those to come. */
const CLIP = {
    now: 'border-gold/70 bg-[linear-gradient(color-mix(in_srgb,var(--color-gold)_24%,transparent),color-mix(in_srgb,var(--color-gold)_8%,transparent))] text-gold',
    played: 'border-gold/20 bg-gold/[.045] text-ink-62 hover:border-gold/45 hover:text-ink',
    ahead: 'border-ink/12 bg-ink/[.035] text-ink-52 hover:border-ink/35 hover:text-ink',
}
