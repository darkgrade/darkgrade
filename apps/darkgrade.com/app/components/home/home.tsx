'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'

import { CameraErrors, MONITOR_WIDTH_PIXELS } from '@/app/components/home/camera-errors'
import { DREAM, HERO, LINK, LINKS, MANIFESTO, PRINCIPLES, STUDIO } from '@/app/components/home/content'
import { CALLOUTS, CHAPTERS, type Callout } from '@/app/components/home/cut-scene'
import { FIRST_CUT_COPY, FirstCutApp } from '@/app/components/home/cut-screen'
import { HomeFooter, HomeHeader } from '@/app/components/home/home-chrome'
import { LaptopScreen, SCREEN_WIDTH_PIXELS, transformOnto } from '@/app/components/home/laptop-screen'
import { EXCHANGES_KEPT, type Exchange, LinkDesk } from '@/app/components/home/link-desk'
import { between, watch } from '@/app/components/home/motion'
import { PageTimeline, type TimelineClip, type TimelineControls } from '@/app/components/home/page-timeline'
import { PrincipleSteps } from '@/app/components/home/principle-steps'
import { useHeldWords } from '@/app/components/home/rise'
import { TitleBlock } from '@/app/components/home/title-block'
import { FeatureList } from '@/app/components/products'
import { BTN_GHOST, BTN_SOLID } from '@/app/components/site-links'
import { StarIcon } from '@/app/components/star-icon'

import '@/app/components/home/home.css'

const CALLOUT_NAMES: Record<Callout, string> = { aperture: 'Aperture', focus: 'Focus', shutter: 'Shutter', iso: 'ISO' }
const FIRST_READINGS: Record<Callout, string> = { aperture: 'f/2.8', focus: 'AF-S', shutter: '1/60', iso: '100' }
/** How tall each callout's leader is, in pixels, so the four labels never share a line. */
const LEADER_PIXELS: Record<Callout, number> = { aperture: 50, focus: 26, shutter: 38, iso: 14 }
const DOCUMENT_NUMBER = 'DG-HP-006'
/** The first line of the thesis opens with the word for the one button it is about, which is set in the red of a recording light. */
const [RECORD_WORD, ...WORDS_AFTER_RECORD] = MANIFESTO[0].split(' ')
const AFTER_RECORD = WORDS_AFTER_RECORD.join(' ')

/** The slate and caption of each sheet of the page, in order. The first has no caption: its title block is there instead. */
const SHEETS = [
    { scene: 'Scene 01', title: HERO.eyebrow, caption: '' },
    { scene: 'Scene 02', title: 'Our thesis', caption: 'The shutter button.' },
    { scene: 'Scene 03', title: 'Our thesis', caption: 'Every control it has, all at once.' },
    { scene: 'Scene 04', title: 'Our thesis', caption: 'Every control but one, removed.' },
    { scene: 'Act I', title: LINK.kind, caption: 'Ask on the laptop; Link makes the call; the camera answers.' },
    { scene: 'Act II', title: STUDIO.kind, caption: 'The studio, lit. Move your pointer: the lights lean after it.' },
    {
        scene: 'Act II',
        title: 'First cut',
        caption: 'On the laptop: the takes close up, titles go on, music runs under.',
    },
    { scene: 'Scene 08', title: 'Principles', caption: 'The director’s chair.' },
    { scene: 'Scene 09', title: 'The dream', caption: 'The camera, then light.' },
]
/** Which sheet each of the scene's chapters is on: the last two share one. */
const SHEET_OF_CHAPTER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8]

/** How tall each sheet of the thesis is, in windows: half the usual, so the three of them pass as quickly as one line follows another. */
const THESIS_WINDOWS_TALL = 0.875
/** The picture is drawn at this many device pixels to a CSS pixel at most. */
const MOST_PIXEL_RATIO = 1.75
/**
 * A window narrower than this is a phone's or an upright tablet's, and its picture has at most
 * this many device pixels. An upright tablet's window is tall as well as dense, and at the full
 * ratio it asks for more than twice the pixels a phone does.
 */
const NARROW_WINDOW_PIXELS = 900
const MOST_PIXELS_WHEN_NARROW = 2_300_000

function pixelRatioFor(cssWidth: number, cssHeight: number): number {
    if (cssWidth >= NARROW_WINDOW_PIXELS) return MOST_PIXEL_RATIO
    return Math.min(MOST_PIXEL_RATIO, Math.sqrt(MOST_PIXELS_WHEN_NARROW / (cssWidth * cssHeight)))
}

/** The sheet the principles are stepped through on. The chair's shot is a mark near its end, not its middle. */
const PRINCIPLES_SHEET = 'principles-sheet'
/** How tall that sheet is, in windows: room to scroll through the principles one at a time. */
const PRINCIPLES_WINDOWS_TALL = 3.1
/** How far above the sheet's end the chair's shot is reached: where the middle of an ordinary sheet would be, so the way on to the lens is as long as it was. */
const CHAIR_WINDOWS_FROM_END = 0.875

/** The page as an editor's timeline: one clip a run of sections. */
const CLIPS: TimelineClip[] = [
    { id: 'intro', label: 'Intro', sections: ['hero'], sound: 'quiet' },
    { id: 'thesis', label: 'The thesis', sections: ['fun', 'menus', 'delete'], sound: 'room' },
    { id: 'link', label: 'Link', sections: ['link'], sound: 'speech' },
    { id: 'studio', label: 'Studio', sections: ['studio'], sound: 'speech' },
    { id: 'first-cut', label: 'First cut', sections: ['cut'], sound: 'speech' },
    { id: 'principles', label: 'Principles', sections: [PRINCIPLES_SHEET], sound: 'room' },
    { id: 'the-dream', label: 'The dream', sections: ['dream'], sound: 'quiet' },
]

/**
 * When the words of the last two sheets go and come, as shares of the picture's moves: the
 * principles go out early in the move from the chair to the lens, well before their sheet stops
 * holding them; the closing words come up over the second half of the ring's forming.
 */
const WORDS = { principlesGoFrom: 0.04, principlesGoneBy: 0.42, dreamComesFrom: 0.45, dreamHereBy: 0.95 }

/** The principles as this page words them: the first is retitled. */
const PRINCIPLES_HERE = PRINCIPLES.map((principle, index) =>
    index === 0 ? { ...principle, title: 'Human-First. No Slop.' } : principle
)

/** The window under the tabs and above the timeline: what the picture and each pinned sheet fill. */
const STAGE_HEIGHT = 'h-[calc(100dvh-var(--timeline-h))]'
/** Everything fixed over the page rides up with the last of it when the footer comes in, by `--lift`, so the picture stays where its words are. */
const LIFTED = '[translate:0_calc(var(--lift,0px)*-1)]'
const STAGE = `pointer-events-none fixed inset-x-0 top-0 ${LIFTED} ${STAGE_HEIGHT}`
/** The side of the window the words take: opposite the camera. */
const LEFT = 'max-w-[min(560px,46%)] max-[900px]:max-w-none'
const THESIS = 'font-serif text-[clamp(2.125rem,4.4vw,4.5rem)] leading-[1.04] heading-weight tracking-[-.045em]'
const ACT_TITLE = 'font-serif leading-[1.02] heading-weight tracking-[-.045em] text-balance'
/** The name of a product and what kind of thing it is, over its tagline. */
const KICKER = 'flex items-baseline gap-3 text-[15px] font-medium'
const KIND = 'font-mono text-[11px] font-normal tracking-[.06em] text-ink-52 uppercase'
const SLATE = 'font-mono text-[11px] leading-[22px] tracking-[.18em] uppercase'
/** One row of a rolling slate: the window shows exactly one, and the column of them slides behind it. */
const SLATE_ROW = 'flex h-[22px] items-center whitespace-nowrap'

/** A registration mark: the circle and cross a printer lines sheets up with. */
function RegistrationMark() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-[18px] shrink-0 text-ink/40"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
        >
            <circle cx="12" cy="12" r="6.5" />
            <path d="M12 0v24M0 12h24" />
        </svg>
    )
}

/**
 * The slate at the top of the picture and the caption at its foot. Both stay where they are for
 * the whole page; their words roll, as the boards of names in the title block do, from one
 * sheet's to the next as the picture changes. The page slides `head` and `foot` to do it.
 */
function Slates({ head, foot }: { head: RefObject<HTMLDivElement | null>; foot: RefObject<HTMLDivElement | null> }) {
    return (
        <div aria-hidden="true" className={`${STAGE} z-[7]`}>
            <div className="shell pt-[76px]">
                <div className={`flex items-center justify-between gap-4 border-t border-hair pt-[10px] ${SLATE}`}>
                    <div className="h-[22px] min-w-0 flex-1 overflow-hidden">
                        <div ref={head} className="will-change-transform">
                            {SHEETS.map((sheet, index) => (
                                <div key={index} className={`${SLATE_ROW} justify-between gap-6`}>
                                    <span className="flex min-w-0 items-center gap-4">
                                        <span className="shrink-0 text-gold">{sheet.scene}</span>
                                        <span className="truncate text-ink-66">{sheet.title}</span>
                                    </span>
                                    <span className="flex shrink-0 items-center gap-4 text-ink-52">
                                        <span className="max-[700px]:hidden">{DOCUMENT_NUMBER}</span>
                                        <span>
                                            Sheet {index + 1} of {SHEETS.length}
                                        </span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <RegistrationMark />
                </div>
            </div>
            <div className="shell absolute inset-x-0 bottom-[16px] max-[900px]:hidden [@media(max-height:760px)]:hidden">
                <div className={`h-[22px] overflow-hidden ${SLATE}`}>
                    <div ref={foot} className="will-change-transform">
                        {SHEETS.map((sheet, index) => (
                            <div key={index} className={SLATE_ROW}>
                                {sheet.caption && <span className="mr-3 text-gold">Fig. {index + 1}</span>}
                                <span className="text-ink-52">{sheet.caption}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

interface SheetProps {
    id: string
    /** The name links on the page reach this sheet by, when it has one. */
    anchor?: string
    register: (id: string, element: HTMLElement | null) => void
    /** Where the words sit in the window while the sheet passes. */
    align?: 'middle' | 'bottom' | 'centre'
    /**
     * Shots that are not a sheet of their own: each is reached when the window's middle is this
     * many window-heights below the top of this sheet (above it, when negative).
     */
    marks?: { shot: string; windowsDown: number }[]
    /** How tall the sheet is, in windows, when it needs more scroll than the usual. */
    windowsTall?: number
    children?: React.ReactNode
}

/** Where a sheet's words sit. In the middle they drop to the bottom on a phone, under the camera; centred they sit at the exact middle of the stage. */
const WORDS_AT = {
    middle: 'pt-[124px] pb-[52px] items-center max-[900px]:items-end max-[900px]:pb-[3vh]',
    bottom: 'pb-[62px] items-end max-[900px]:pb-[3vh]',
    // the same on every screen, with no room kept for the slate: the ring is about the middle of the stage, and so must its words be
    centre: 'items-center',
}

/** One chapter: taller than the window, with its words held in place while the picture makes its move. */
function Sheet({ id, anchor, register, align = 'middle', marks = [], windowsTall, children }: SheetProps) {
    return (
        <section
            ref={element => register(id, element)}
            id={anchor}
            data-chapter={id}
            className={`relative ${marks.length > 0 ? 'min-h-[215vh]' : 'min-h-[175vh]'}`}
            style={windowsTall ? { minHeight: `${windowsTall * 100}vh` } : undefined}
        >
            {marks.map(mark => (
                <span
                    key={mark.shot}
                    ref={element => register(mark.shot, element)}
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 h-[2px] w-px"
                    style={{ top: `${mark.windowsDown * 100}vh` }}
                />
            ))}
            <div data-words="ahead" className={`sticky top-0 flex ${STAGE_HEIGHT} ${WORDS_AT[align]}`}>
                <div className="shell">{children}</div>
            </div>
        </section>
    )
}

const order = (place: number) => ({ '--rise-order': place }) as React.CSSProperties

/**
 * The home page. One camera that every section moves,
 * drawn in line from first to last: it opens in pieces, comes together for the thesis, and is
 * driven from a laptop that then rides to the studio with it. Studio gear gathers out of dust
 * around them; the first cut runs on that laptop; the principles are told from the director's
 * chair; and at the end the camera goes to dust and the dust to a ring of light around the
 * closing words. Along the bottom the page is an editor's timeline, and a slate at the top and
 * a caption at the foot roll from sheet to sheet.
 */
export function Home() {
    const page = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)
    const sections = useRef(new Map<string, HTMLElement>())
    const callouts = useRef(new Map<Callout, HTMLElement>())
    const readings = useRef(new Map<Callout, HTMLElement>())
    const laptopScreen = useRef<HTMLDivElement>(null)
    const monitor = useRef<HTMLDivElement>(null)
    const linkLayer = useRef<HTMLDivElement>(null)
    const cutLayer = useRef<HTMLDivElement>(null)
    const slateHead = useRef<HTMLDivElement>(null)
    const slateFoot = useRef<HTMLDivElement>(null)
    const footer = useRef<HTMLDivElement>(null)
    const principlesWords = useRef<HTMLDivElement>(null)
    const dreamWords = useRef<HTMLDivElement>(null)
    const [exchanges, setExchanges] = useState<Exchange[]>([])
    const [typing, setTyping] = useState<string | null>(null)
    const exchangeCount = useRef(0)
    const [principle, setPrinciple] = useState(0)
    const [ready, setReady] = useState(false)
    useHeldWords(page)
    const timeline = useRef<TimelineControls>(null)
    const watchItInAction = () => timeline.current?.playFromStart()

    useEffect(() => {
        const [target, host] = [canvas.current, page.current]
        if (!target || !host) return
        let stop: (() => void) | undefined
        let unmounted = false
        void Promise.all([import('@/app/components/home/viewport'), import('@/app/components/home/cut-scene')]).then(
            ([{ runViewport }, { buildCutScene }]) => {
                if (unmounted) return
                stop = runViewport(
                    target,
                    () =>
                        buildCutScene({
                            sections: CHAPTERS.map(chapter => sections.current.get(chapter)!),
                            placeCallout(callout, x, y, strength) {
                                const element = callouts.current.get(callout)
                                if (!element) return
                                element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
                                element.style.opacity = strength.toFixed(3)
                            },
                            setReading(callout, text) {
                                const element = readings.current.get(callout)
                                if (element) element.textContent = text
                            },
                            typeCall: setTyping,
                            logCall(request, call) {
                                const id = exchangeCount.current++
                                setTyping(null)
                                setExchanges(previous => [
                                    ...previous.slice(-(EXCHANGES_KEPT - 1)),
                                    { id, request, call, answered: false },
                                ])
                            },
                            answerCall: () =>
                                setExchanges(previous =>
                                    previous.map((exchange, index) =>
                                        index === previous.length - 1 ? { ...exchange, answered: true } : exchange
                                    )
                                ),
                            showState(state) {
                                host.style.setProperty('--cut', state.cut.toFixed(4))
                                host.style.setProperty('--rolling', state.rolling.toFixed(3))
                                host.style.setProperty('--words-over-picture', state.wordsOverPicture.toFixed(3))
                            },
                            showChapter(chapter) {
                                const index = Math.min(SHEET_OF_CHAPTER.length - 1, Math.floor(chapter))
                                const next = Math.min(SHEET_OF_CHAPTER.length - 1, index + 1)
                                const sheet =
                                    SHEET_OF_CHAPTER[index] +
                                    (SHEET_OF_CHAPTER[next] - SHEET_OF_CHAPTER[index]) * (chapter - index)
                                const rolled = `translateY(${((-sheet / SHEETS.length) * 100).toFixed(3)}%)`
                                if (slateHead.current) slateHead.current.style.transform = rolled
                                if (slateFoot.current) slateFoot.current.style.transform = rolled
                                const leavingTheChair = chapter - CHAPTERS.indexOf('principles')
                                if (principlesWords.current)
                                    principlesWords.current.style.opacity = (
                                        1 - between(leavingTheChair, WORDS.principlesGoFrom, WORDS.principlesGoneBy)
                                    ).toFixed(3)
                                const dream = between(
                                    chapter - CHAPTERS.indexOf('lens'),
                                    WORDS.dreamComesFrom,
                                    WORDS.dreamHereBy
                                )
                                if (!dreamWords.current) return
                                dreamWords.current.style.opacity = dream.toFixed(3)
                                // Only the words themselves take the pointer, and only once they can be seen: the layer they are held in covers the stage.
                                const words = dreamWords.current.firstElementChild
                                if (words instanceof HTMLElement)
                                    words.style.pointerEvents = dream > 0.5 ? 'auto' : 'none'
                            },
                            placeMonitor(corners, widthOverHeight, strength) {
                                const element = monitor.current
                                if (!element) return
                                const height = MONITOR_WIDTH_PIXELS / widthOverHeight
                                element.style.height = `${height.toFixed(1)}px`
                                element.style.opacity = strength.toFixed(3)
                                if (strength > 0)
                                    element.style.transform = transformOnto(MONITOR_WIDTH_PIXELS, height, corners)
                            },
                            placeScreen(corners, widthOverHeight, showing) {
                                const element = laptopScreen.current
                                if (!element) return
                                const height = SCREEN_WIDTH_PIXELS / widthOverHeight
                                const shown = Math.max(showing.link, showing.cut)
                                element.style.height = `${height.toFixed(1)}px`
                                element.style.opacity = shown.toFixed(3)
                                if (shown > 0)
                                    element.style.transform = transformOnto(SCREEN_WIDTH_PIXELS, height, corners)
                                if (linkLayer.current)
                                    linkLayer.current.style.opacity = showing.link > showing.cut ? '1' : '0'
                                if (cutLayer.current)
                                    cutLayer.current.style.opacity = showing.cut >= showing.link ? '1' : '0'
                            },
                        }),
                    { maximumPixelRatio: pixelRatioFor, onReady: () => setReady(true) }
                )
            }
        )
        return () => {
            unmounted = true
            stop?.()
        }
    }, [])

    // How far the footer has come up into the window is how far everything fixed over the page is lifted.
    useEffect(() => {
        const [host, foot] = [page.current, footer.current]
        if (!host || !foot) return
        const stopLifting = watch(
            () => Math.max(0, innerHeight - foot.getBoundingClientRect().top),
            lift => host.style.setProperty('--lift', `${lift.toFixed(1)}px`)
        )
        // The timeline is below the first fold, as if it were the next thing on the page: scrolling brings it up until it docks.
        const timelineHeight = () => parseFloat(getComputedStyle(host).getPropertyValue('--timeline-h'))
        const stopDropping = watch(
            () => Math.max(0, timelineHeight() - scrollY),
            drop => {
                host.style.setProperty('--drop', `${drop.toFixed(1)}px`)
                host.style.setProperty('--first-fold', (drop / timelineHeight()).toFixed(3))
            }
        )
        const stopStepping = watch(
            () => Math.min(PRINCIPLES_HERE.length - 1, Math.floor(principlesRead() * PRINCIPLES_HERE.length)),
            setPrinciple
        )
        return () => {
            stopLifting()
            stopDropping()
            stopStepping()
        }
    }, [])

    /** How far the principles' sheet has to scroll, from being pinned to the chair's shot being reached, in pixels. */
    const principlesScroll = () => {
        const [sheet, chair] = [sections.current.get(PRINCIPLES_SHEET), sections.current.get('principles')]
        if (!sheet || !chair) return { top: 0, length: 0 }
        const top = sheet.getBoundingClientRect().top
        return { top, length: chair.getBoundingClientRect().top - top - innerHeight / 2 }
    }
    /** The share of that scroll already made: each principle is open for an equal part of it. */
    const principlesRead = () => {
        const { top, length } = principlesScroll()
        return length > 0 ? Math.min(0.999, Math.max(0, -top / length)) : 0
    }
    /** Scrolls to the middle of a principle's part, which opens it. */
    const goToPrinciple = (index: number) => {
        const { top, length } = principlesScroll()
        scrollTo({ top: scrollY + top + ((index + 0.5) / PRINCIPLES_HERE.length) * length, behavior: 'smooth' })
    }

    const register = (id: string, element: HTMLElement | null) => {
        if (element) sections.current.set(id, element)
    }

    return (
        <div ref={page} id="top" className="home relative bg-bg text-ink">
            <HomeHeader />

            <canvas
                ref={canvas}
                aria-hidden="true"
                className={`fixed inset-x-0 top-0 z-0 w-full transition-opacity duration-[900ms] ${LIFTED} ${STAGE_HEIGHT} ${ready ? 'opacity-100' : 'opacity-0'}`}
            />
            {/* on a phone the words run under the camera: the page darkens below it so they stay readable */}
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-x-0 bottom-0 z-0 hidden h-[64dvh] bg-gradient-to-t from-bg from-55% to-transparent max-[900px]:block"
            />

            {/* where the words lie over the studio, the picture is dimmed behind them: across the whole stage and fading out sideways, so it has no edge */}
            <div
                aria-hidden="true"
                className={`${STAGE} z-[1] bg-[linear-gradient(to_right,rgba(10,10,11,.88),rgba(10,10,11,.72)_34%,transparent_58%)] opacity-[var(--words-over-picture,0)] max-[900px]:hidden`}
            />

            <div aria-hidden="true" className={`${STAGE} z-[5] overflow-hidden max-[900px]:hidden`}>
                {CALLOUTS.map(callout => (
                    <div
                        key={callout}
                        ref={element => {
                            if (element) callouts.current.set(callout, element)
                        }}
                        className="absolute top-0 left-0 opacity-0 will-change-transform"
                    >
                        <span className="absolute top-[-3px] left-[-3px] size-[7px] rounded-full bg-gold shadow-[0_0_10px_rgba(244,198,110,.9)]" />
                        <span
                            className="absolute bottom-0 left-0 w-px bg-gradient-to-t from-gold/80 to-gold/20"
                            style={{ height: LEADER_PIXELS[callout] }}
                        />
                        <span
                            className="absolute left-[-1px] flex -translate-y-full flex-col border-l border-gold/60 pb-[2px] pl-[10px] whitespace-nowrap"
                            style={{ top: -LEADER_PIXELS[callout] }}
                        >
                            <span className="font-mono text-[10px] tracking-[.1em] text-ink-55 uppercase">
                                {CALLOUT_NAMES[callout]}
                            </span>
                            <span
                                ref={element => {
                                    if (element) readings.current.set(callout, element)
                                }}
                                className="glow-sm font-serif text-[1.375rem] leading-[1.1] font-medium tracking-[-.03em] tabular-nums"
                            >
                                {FIRST_READINGS[callout]}
                            </span>
                        </span>
                    </div>
                ))}
            </div>

            {/* what runs on the laptop, and what the camera's own monitor says in the menus chapter, each laid over its screen in the picture */}
            <div aria-hidden="true" className={`${STAGE} z-[6] overflow-hidden`}>
                <CameraErrors frame={monitor} />
                <LaptopScreen
                    frame={laptopScreen}
                    link={{ layer: linkLayer, children: <LinkDesk exchanges={exchanges} typing={typing} /> }}
                    cut={{ layer: cutLayer, children: <FirstCutApp /> }}
                />
            </div>

            <Slates head={slateHead} foot={slateFoot} />

            {/* The closing words are not part of the page that scrolls: they are held at the middle of the stage, where the ring forms, and come up in place as it does. */}
            <div ref={dreamWords} className={`${STAGE} z-[11] flex items-center opacity-0`}>
                {/* the words sit inside the ring of light, so they are held to its width */}
                <div className="mx-auto w-[min(86vw,calc((100dvh-var(--timeline-h))*.62),52vw)] text-center max-[900px]:w-[min(58vw,calc((100dvh-var(--timeline-h))*.4))]">
                    <h2 className="font-serif text-[clamp(1.25rem,2.3vw,2.25rem)] leading-[1.2] heading-weight tracking-[-.04em] max-[900px]:text-[clamp(1rem,2.7vw,1.5rem)]">
                        {DREAM.line} <span className="text-ink-52">{DREAM.turn}</span>
                    </h2>
                    <p className="glow-hot mx-auto mt-[clamp(14px,3vh,30px)] max-w-[20ch] font-serif text-[clamp(1.375rem,2.5vw,2.5rem)] leading-[1.1] heading-weight tracking-[-.04em] italic max-[900px]:mt-[12px] max-[900px]:text-[clamp(1.125rem,3vw,1.75rem)]">
                        {DREAM.punch}
                    </p>
                    <div className="mt-[clamp(20px,4vh,40px)] flex flex-wrap justify-center gap-[14px] max-[900px]:mt-[18px] max-[900px]:gap-[8px]">
                        <button type="button" className={`${BTN_SOLID} cursor-pointer`} onClick={watchItInAction}>
                            <span>{HERO.watch}</span>
                        </button>
                        <a className={BTN_GHOST} href={LINKS.github} target="_blank" rel="noopener">
                            <span>Star on GitHub</span>
                            <StarIcon className="size-[.85em] text-gold" />
                        </a>
                    </div>
                </div>
            </div>

            {/* the title block is the last thing on the first fold; it stays where it is and fades as the page is scrolled and the timeline comes up over it */}
            <div
                aria-hidden="true"
                className="pointer-events-none fixed inset-x-0 bottom-[22px] z-[8] opacity-[var(--first-fold,1)] [@media(max-height:700px)]:hidden"
            >
                <div className="shell">
                    <TitleBlock document={DOCUMENT_NUMBER} sheet={1} sheets={SHEETS.length} />
                </div>
            </div>

            <main className="relative z-10">
                {/* the first fold is the whole window: the timeline is not in it, and the title block is the last thing on it */}
                <section
                    ref={element => register('hero', element)}
                    data-chapter="hero"
                    className="relative flex h-dvh min-h-[620px] flex-col"
                >
                    <div
                        data-words="ahead"
                        className="flex h-dvh min-h-0 flex-1 items-center pt-[124px] max-[900px]:items-end max-[900px]:pb-[26px]"
                    >
                        <div className="shell">
                            <div className={LEFT}>
                                <h1
                                    className="ml-[-.04em] font-serif text-[clamp(2.5rem,min(8.2vw,12.5svh),8.5rem)] leading-[.94] heading-weight tracking-[-.05em]"
                                    data-rise
                                    style={order(1)}
                                >
                                    <span className="block whitespace-nowrap">Shoot more.</span>
                                    <span className="block whitespace-nowrap">
                                        Edit <span className="glow-hot italic">less.</span>
                                    </span>
                                </h1>
                                <p
                                    className="mt-[clamp(18px,3vh,36px)] max-w-[52ch] text-lede leading-[1.65] text-ink-66"
                                    data-rise
                                    style={order(2)}
                                >
                                    {HERO.lede}
                                </p>
                                <div
                                    className="mt-[clamp(20px,3.4vh,40px)] flex flex-wrap items-center gap-[18px]"
                                    data-rise
                                    style={order(3)}
                                >
                                    <button
                                        type="button"
                                        className={`${BTN_SOLID} cursor-pointer`}
                                        onClick={watchItInAction}
                                    >
                                        <span>{HERO.watch}</span>
                                        <svg
                                            width="14"
                                            height="14"
                                            viewBox="0 0 24 24"
                                            fill="currentColor"
                                            aria-hidden="true"
                                        >
                                            <path d="M5 3l14 9-14 9V3z" />
                                        </svg>
                                    </button>
                                    <a className={BTN_GHOST} href={HERO.secondary.href} target="_blank" rel="noopener">
                                        <span>{HERO.secondary.label}</span>
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <Sheet id="fun" register={register} windowsTall={THESIS_WINDOWS_TALL}>
                    <p className={`${THESIS} ${LEFT}`} data-rise>
                        <span className="text-rec">{RECORD_WORD}</span> {AFTER_RECORD}
                    </p>
                </Sheet>

                <Sheet id="menus" register={register} windowsTall={THESIS_WINDOWS_TALL}>
                    <p className={`${THESIS} ${LEFT}`} data-rise>
                        {MANIFESTO[1]}
                    </p>
                </Sheet>

                <Sheet id="delete" register={register} windowsTall={THESIS_WINDOWS_TALL}>
                    <p className={`${THESIS} ${LEFT}`} data-rise>
                        We’re deleting <em className="glow-hot italic">the rest.</em>
                    </p>
                </Sheet>

                <div id="product" />
                {/* the camera is up and to the left with what Link is under it; the laptop it is driven from is on the right */}
                <Sheet id="link" anchor="link" register={register} align="bottom">
                    <div className="max-w-[min(460px,36%)] max-[900px]:max-w-none">
                        <p className={KICKER} data-rise>
                            <span className="text-gold">{LINK.name}</span>
                            <span className={KIND}>{LINK.kind}</span>
                        </p>
                        <h2
                            className={`${ACT_TITLE} mt-[10px] text-[clamp(1.75rem,min(3vw,5.2vh),2.875rem)]`}
                            data-rise
                            style={order(1)}
                        >
                            {LINK.tagline}
                        </h2>
                        <p
                            className="mt-[clamp(8px,1.4vh,14px)] max-w-[44ch] text-body leading-[1.5] text-ink-66 [@media(max-height:960px)]:hidden"
                            data-rise
                            style={order(2)}
                        >
                            {LINK.does}
                        </p>
                        <div className="mt-[clamp(12px,2vh,22px)]" data-rise style={order(3)}>
                            <FeatureList features={LINK.features} />
                        </div>
                    </div>
                </Sheet>

                <Sheet id="studio" anchor="studio" register={register}>
                    <div className="max-w-[min(520px,42%)] max-[900px]:max-w-none">
                        <p className={KICKER} data-rise>
                            <span className="text-gold">{STUDIO.name}</span>
                            <span className={KIND}>{STUDIO.kind}</span>
                        </p>
                        <h2
                            className={`${ACT_TITLE} mt-[12px] text-[clamp(2.25rem,min(4.2vw,7vh),4rem)]`}
                            data-rise
                            style={order(1)}
                        >
                            {STUDIO.tagline}
                        </h2>
                        <p
                            className="mt-[clamp(10px,1.8vh,18px)] max-w-[44ch] text-body leading-[1.5] text-ink-66"
                            data-rise
                            style={order(2)}
                        >
                            {STUDIO.does}
                        </p>
                        <div className="mt-[clamp(14px,2.4vh,26px)]" data-rise style={order(3)}>
                            <FeatureList features={STUDIO.features} />
                        </div>
                    </div>
                </Sheet>

                {/* on a wide window the laptop's screen says all of this itself; a narrow one's screen is too small to read, so the words stand under it */}
                <Sheet id="cut" register={register} align="bottom">
                    <div className="min-[900px]:sr-only">
                        <p className={KICKER} data-rise>
                            <span className="text-gold">{FIRST_CUT_COPY.title}</span>
                            <span className={KIND}>{FIRST_CUT_COPY.status}</span>
                        </p>
                        <h2
                            className={`${ACT_TITLE} mt-[10px] text-[clamp(1.75rem,min(5vw,5.2vh),2.875rem)]`}
                            data-rise
                            style={order(1)}
                        >
                            {FIRST_CUT_COPY.tagline}
                        </h2>
                        <p
                            className="mt-[clamp(8px,1.4vh,14px)] max-w-[44ch] text-body leading-[1.5] text-ink-66"
                            data-rise
                            style={order(2)}
                        >
                            {FIRST_CUT_COPY.does}
                        </p>
                        {/* a phone has no room for these under the screen; an upright tablet has */}
                        <div
                            className="mt-[clamp(12px,2vh,22px)] [@media(max-height:900px)]:hidden"
                            data-rise
                            style={order(3)}
                        >
                            <FeatureList features={FIRST_CUT_COPY.steps.map(text => ({ text, on: false }))} />
                        </div>
                    </div>
                </Sheet>

                {/* these words do not scroll away: they go out where they stand as the view leaves the chair, before their sheet lets go of them */}
                <Sheet
                    id={PRINCIPLES_SHEET}
                    anchor="principles"
                    register={register}
                    windowsTall={PRINCIPLES_WINDOWS_TALL}
                    marks={[{ shot: 'principles', windowsDown: PRINCIPLES_WINDOWS_TALL - CHAIR_WINDOWS_FROM_END }]}
                >
                    <div ref={principlesWords} className={LEFT}>
                        <h2
                            className="font-serif text-[clamp(2rem,min(4vw,5.6vh),3.75rem)] leading-[1.04] heading-weight tracking-[-.045em]"
                            data-rise
                        >
                            You stay <em className="glow-hot italic">the director.</em>
                        </h2>
                        <div className="mt-[clamp(18px,3.2vh,40px)]" data-rise style={order(1)}>
                            <PrincipleSteps principles={PRINCIPLES_HERE} active={principle} onChoose={goToPrinciple} />
                        </div>
                    </div>
                </Sheet>

                {/* the view leaves the chair for the camera while the principles are still up; the camera goes to dust as this sheet arrives, and is a ring when its words are in place */}
                <Sheet
                    id="dream"
                    register={register}
                    align="centre"
                    marks={[
                        { shot: 'lens', windowsDown: -0.2 },
                        { shot: 'ring', windowsDown: 0.47 },
                    ]}
                ></Sheet>

                {/* the timeline's place once the footer has pushed it up off the bottom of the window */}
                <div className="h-[var(--timeline-h)]" />
                <div ref={footer}>
                    <HomeFooter className="panel" />
                </div>
            </main>

            <PageTimeline clips={CLIPS} sections={sections} after={footer} controls={timeline} />
        </div>
    )
}
