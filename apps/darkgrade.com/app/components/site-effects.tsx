'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { getBgMode, setBgMode, subscribeBgMode } from './background-mode'
import { createBackgrounds } from './backgrounds'
import { BACKGROUND_VIDEO_ID, CONTOUR_BACKGROUND_ENABLED, VIDEO_BACKGROUND_ENABLED } from './backgrounds/field'
import { createYouTubeBackdrop } from './backgrounds/youtube'
import { formatStatValue } from './stats'

/**
 * How fast the opening plays. 1 is the original pacing; 2 halves the whole
 * sequence - the count and every beat of the intro together - by scaling the
 * timeline rather than editing ten durations, so the overlaps it was tuned
 * around stay exactly where they were.
 *
 * Speed Index is dominated by this: until the loader clears, the filmstrip is
 * all preloader, so this knob is the page's main lever on that metric.
 */
const INTRO_SPEED = 2

/**
 * The headline beat. These four are locked together, so move them as a group:
 * `less.` cannot start glowing until its mask is open (a text-shadow inside
 * overflow:hidden is clipped into a visible rectangle - that is what the
 * --glow ramp exists to hold back), and the mask cannot open until the line is
 * nearly home, or the still-rising glyphs spill out of the box.
 *
 * power4.out leaves (1 - t)^4 of the travel to go, so opening at t = 0.65 of
 * the trailing line's rise leaves ~1.8% - roughly 3px at the desktop size,
 * which reads as nothing.
 */
const HERO_RISE_AT = 0.7
const HERO_RISE_DURATION = 0.7
const HERO_STAGGER = 0.05
const HERO_LIT_AT = HERO_RISE_AT + HERO_STAGGER + HERO_RISE_DURATION * 0.65

type Gsap = (typeof import('gsap'))['gsap']
type LocomotiveScrollClass = (typeof import('locomotive-scroll'))['default']
type Locomotive = InstanceType<LocomotiveScrollClass>
type Motion = { gsap: Gsap; LocomotiveScroll: LocomotiveScrollClass }

/* gsap and locomotive both touch window at import time, so they load in the
   browser only, once, behind the webfont: line splitting and the marquee both
   measure text, and measuring the fallback face groups it wrongly. */
let motionPromise: Promise<Motion> | null = null
function loadMotion(): Promise<Motion> {
    motionPromise ??= Promise.all([
        import('gsap'),
        import('locomotive-scroll'),
        document.fonts?.ready ?? Promise.resolve(),
    ]).then(([gsapModule, locomotiveModule]) => ({
        gsap: gsapModule.gsap,
        LocomotiveScroll: locomotiveModule.default,
    }))
    return motionPromise
}

/** State the site-wide layer and the per-page layer share. */
type Shared = {
    loco: Locomotive | null
    scrollVelocity: number
    scrollDirection: number
    /** Scroll distance over which the dim runs 0 -> 1; null = this page sits at full dim. */
    dimDistance: number | null
    updateDim: () => void
    silk: ReturnType<typeof createBackgrounds> | null
}

/**
 * Every moving part of the site, mounted once in the (site) layout so it
 * survives client-side navigation: the backdrop video never reloads and the
 * preloader only ever plays on a first visit to the home page.
 *
 * Two effects. The site-wide one runs once: backdrop, dim layer, cursor,
 * header state, in-page links, the npm copy button and the first-load intro.
 * The page one re-runs on every route: smooth scroll and the scroll reveals,
 * line splitting, the marquee, the stat counters and, when the home page is
 * reached by navigation rather than a load, the hero's entrance.
 *
 * Both tear everything down again, so a StrictMode double effect in
 * development leaves nothing running twice.
 */
export function SiteEffects() {
    const pathname = usePathname()
    const shared = useRef<Shared>({
        loco: null,
        scrollVelocity: 0,
        scrollDirection: 1,
        dimDistance: null,
        updateDim: () => {},
        silk: null,
    })
    /* The first page the visitor lands on gets its hero from the intro
       timeline; every page after that is a navigation. */
    const previousPathname = useRef<string | null>(null)
    const hasNavigated = useRef(false)

    /* ======================= site-wide, once ======================= */
    useEffect(() => {
        const state = shared.current
        const ac = new AbortController()
        const signal = ac.signal
        const teardown: Array<() => void> = []
        let cancelled = false

        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        const isTouch = matchMedia('(hover: none)').matches

        /* ============ backdrops ============
           two renderers, one clock: the silk shader and the topographic
           contours the site used to run. Parked behind VIDEO_BACKGROUND_ENABLED;
           neither keeps its own elapsed time, so a parked layer resumes in phase. */
        const silkCanvas = document.getElementById('gl') as HTMLCanvasElement | null
        const contourCanvas = document.getElementById('contours') as HTMLCanvasElement | null
        if (silkCanvas) {
            // reduced motion: the backdrop renders one still frame and ignores the pointer
            const layers = createBackgrounds(silkCanvas, contourCanvas, { animate: !reduced })
            state.silk = layers
            teardown.push(() => {
                layers.destroy()
                state.silk = null
            })
            // no WebGL? the contours are a complete background on their own
            if (CONTOUR_BACKGROUND_ENABLED && !layers.silkAvailable && getBgMode() === 'silk') setBgMode('contours')
            layers.setMode(getBgMode())
            teardown.push(subscribeBgMode(m => layers.setMode(m)))
            const ro = new ResizeObserver(() => layers.resize())
            ro.observe(silkCanvas)
            teardown.push(() => ro.disconnect())
            if (!reduced) addEventListener('pointermove', e => layers.setPointer(e.clientX, e.clientY), { signal })
            document.addEventListener('visibilitychange', () => (document.hidden ? layers.stop() : layers.start()), {
                signal,
            })
            layers.start()
        }

        /* ============ video backdrop ============
           reduced motion never loads the player at all: those visitors keep
           the poster frame, and nothing streams. */
        const videoMount = document.getElementById('bgyt-mount')
        const videoFrame = document.getElementById('bgyt')
        if (videoMount && videoFrame && !reduced) {
            teardown.push(createYouTubeBackdrop(videoMount, videoFrame, BACKGROUND_VIDEO_ID))
        }

        /* ============ dim layer ============
           --dim-p runs 0 -> 1 over the page's dimDistance (set per page: the
           distance until the marquee reaches the top of the window). Read from
           the native scroll position, which lenis drives too. */
        const dim = document.getElementById('dim')
        if (dim) {
            let dimRaf = 0
            const update = () => {
                dimRaf = 0
                const distance = state.dimDistance
                const progress = distance === null ? 1 : Math.min(1, Math.max(0, window.scrollY / distance))
                dim.style.setProperty('--dim-p', progress.toFixed(4))
            }
            state.updateDim = () => {
                if (!dimRaf) dimRaf = requestAnimationFrame(update)
            }
            update()
            addEventListener('scroll', state.updateDim, { passive: true, signal })
            teardown.push(() => cancelAnimationFrame(dimRaf))
        }

        /* ============ scroll progress consumers ============
           one listener for everything locomotive scrubs: masks reopen so the
           glow can bleed once a block has fully landed, and the stat counters
           read straight off progress instead of firing a tween. */
        addEventListener(
            'lsprog',
            evt => {
                const { target, progress } = (evt as CustomEvent<{ target: HTMLElement; progress: number }>).detail
                if (target.classList.contains('count')) {
                    // same band the reveals use, so a stat lands with its row
                    const fraction = Math.min(1, Math.max(0, (progress - 0.1) / 0.28))
                    target.textContent = formatStatValue(Number(target.dataset.to), fraction)
                    return
                }
                if (target.classList.contains('rv')) {
                    const done = progress >= (target.classList.contains('tail') ? 0.99 : 0.38)
                    target.querySelectorAll('.ln-mask,.mask').forEach(m => m.classList.toggle('open', done))
                }
            },
            { signal }
        )

        /* ============ header state ============
           a 1px marker parked 40px down the document - when it leaves the top of
           the viewport we are scrolled. */
        const hdr = document.getElementById('hdr')
        const mark = document.getElementById('top-mark')
        if (hdr && mark) {
            const io = new IntersectionObserver(es => hdr.classList.toggle('scrolled', !es[0].isIntersecting))
            io.observe(mark)
            teardown.push(() => io.disconnect())
        }

        /* ============ npm copy ============
           delegated, so it covers whichever page is mounted */
        document.addEventListener(
            'click',
            e => {
                const el = (e.target as Element | null)?.closest?.<HTMLElement>('[data-copy]')
                if (!el) return
                const txt = el.dataset.copy ?? ''
                const label = el.querySelector<HTMLElement>('.copy')
                const status = el.querySelector<HTMLElement>('.copy-status')
                const report = (shortLabel: string, announcement: string) => {
                    if (status) status.textContent = announcement
                    if (!label) return
                    label.textContent = shortLabel
                    label.style.color = 'var(--color-gold)'
                    setTimeout(() => {
                        label.textContent = 'Copy'
                        label.style.color = ''
                        if (status) status.textContent = ''
                    }, 1600)
                }
                const copied = () => report('Copied ✓', 'Install command copied')
                const failed = () => report('Copy failed', `Couldn't copy. Type ${txt} in your terminal instead.`)
                if (navigator.clipboard) navigator.clipboard.writeText(txt).then(copied, failed)
                else failed()
            },
            { signal }
        )

        /* ============ in-page links ============
           links into the page you are on scroll through lenis instead of
           hard-jumping. They are written "/#id" or "/" so they also work from
           other pages, where <Link> navigates client-side. Capture phase, so this
           runs before <Link>'s own handler, which stands down once the event's
           default is prevented. A link to this page with no hash (the logo) goes
           to the top; one with a hash scrolls to that element. */
        document.addEventListener(
            'click',
            e => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                const a = (e.target as Element | null)?.closest?.<HTMLAnchorElement>('a[href]')
                if (!a || a.target === '_blank') return
                const url = new URL(a.href, location.href)
                if (url.origin !== location.origin || url.pathname !== location.pathname) return
                const href = url.hash || '#'
                const target: HTMLElement | 0 | null = href === '#' ? 0 : document.getElementById(href.slice(1))
                if (target === null) return // dead anchor, leave it alone
                e.preventDefault()
                // clear the fixed header, which is 64px once scrolled
                const headerOffset = -(hdr?.offsetHeight ?? 64) - 24
                if (state.loco) state.loco.scrollTo(target, { duration: 1.4, offset: target === 0 ? 0 : headerOffset })
                else if (target === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
                else target.scrollIntoView({ behavior: 'smooth' }) // scroll-padding-top clears the header
                // preventDefault also cancels the browser's focus move: do it by hand,
                // so the next Tab continues from the section rather than the nav
                const focusTarget = target === 0 ? document.querySelector<HTMLElement>('main') : target
                if (focusTarget) {
                    if (!focusTarget.hasAttribute('tabindex')) focusTarget.setAttribute('tabindex', '-1')
                    focusTarget.focus({ preventScroll: true })
                }
                history.replaceState(history.state, '', href === '#' ? location.pathname : href)
            },
            { signal, capture: true }
        )

        void loadMotion()
            .then(({ gsap }) => {
                if (cancelled) return

                /* ---------- cursor ---------- */
                const dot = document.querySelector<HTMLElement>('.cursor-dot')
                const ring = document.querySelector<HTMLElement>('.cursor-ring')
                if (!isTouch && dot && ring) {
                    const pos = { x: innerWidth / 2, y: innerHeight / 2 }
                    const ringPos = { ...pos }
                    let shown = false
                    addEventListener(
                        'pointermove',
                        e => {
                            pos.x = e.clientX
                            pos.y = e.clientY
                            if (!shown) {
                                shown = true
                                gsap.to([dot, ring], { opacity: 1, duration: 0.4 })
                            }
                        },
                        { signal }
                    )
                    const tick = () => {
                        ringPos.x += (pos.x - ringPos.x) * 0.14
                        ringPos.y += (pos.y - ringPos.y) * 0.14
                        gsap.set(dot, { x: pos.x - 2.5, y: pos.y - 2.5 })
                        gsap.set(ring, { x: ringPos.x - 17, y: ringPos.y - 17 }) // half of 34px, no layout read
                    }
                    gsap.ticker.add(tick)
                    teardown.push(() => gsap.ticker.remove(tick))
                    // delegated, so links on whichever page is mounted still grow the ring
                    let hovered: Element | null = null
                    document.addEventListener(
                        'pointerover',
                        e => {
                            const control = (e.target as Element | null)?.closest?.('a,button') ?? null
                            if (control === hovered) return
                            hovered = control
                            ring.classList.toggle('is-link', Boolean(control))
                            gsap.to(ring, {
                                scale: control ? 56 / 34 : 1,
                                duration: 0.35,
                                ease: 'power3.out',
                                overwrite: 'auto',
                            })
                        },
                        { signal }
                    )
                    document.documentElement.addEventListener(
                        'pointerleave',
                        () => gsap.to([dot, ring], { opacity: 0, duration: 0.3 }),
                        { signal }
                    )
                    document.documentElement.addEventListener(
                        'pointerenter',
                        () => gsap.to([dot, ring], { opacity: 1, duration: 0.3 }),
                        { signal }
                    )
                }

                /* ---------- preloader + first-load intro ---------- */
                const loader = document.getElementById('loader')
                const hasLoader = Boolean(loader) && document.documentElement.classList.contains('intro')
                const lnum = document.getElementById('lnum')
                const lbar = document.getElementById('lbar')
                // one span per digit, so the count never reflows - see <Loader>
                const digits = lnum ? [...lnum.querySelectorAll<HTMLElement>('span')] : []
                const showCount = (v: number) => {
                    const s = String(Math.round(v)).padStart(3, '0')
                    digits.forEach((d, i) => (d.textContent = s[i] ?? '0'))
                }

                const intro = () => {
                    document.documentElement.classList.remove('preload')
                    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
                    tl.timeScale(INTRO_SPEED)
                    teardown.push(() => {
                        tl.kill()
                    })
                    // every beat starts before the one before it finishes, so the
                    // whole thing reads as one move rather than a queue
                    if (hasLoader && loader) {
                        tl.to(loader, { yPercent: -100, duration: 0.9, ease: 'power3.inOut' }, 0)
                            .set(loader, { display: 'none' })
                            .call(() => document.documentElement.classList.remove('intro'))
                    }
                    tl.to('#bg', { opacity: 1, duration: hasLoader ? 1.3 : 0.8, ease: 'power2.inOut' }, hasLoader ? 0.2 : 0)
                    if (state.silk) tl.to(state.silk.intro, { value: 1, duration: 1.6, ease: 'power2.inOut' }, 0.2)
                    // the first page's hero lands here, in step with the loader
                    if (document.querySelector('.hero')) {
                        addHeroEntrance(gsap, tl, { reduced, at: HERO_RISE_AT })
                        if (!reduced)
                            tl.from(
                                '#hdr',
                                { y: -30, opacity: 0, duration: 0.7, ease: 'power3.out' },
                                HERO_RISE_AT + 0.4
                            )
                    }
                }

                if (reduced || !hasLoader) {
                    showCount(100)
                    intro()
                    return
                }
                const o = { v: 0 }
                const count = gsap.to(o, {
                    v: 100,
                    duration: 1 / INTRO_SPEED,
                    ease: 'power2.inOut',
                    onUpdate: () => {
                        showCount(o.v)
                        if (lbar) gsap.set(lbar, { scaleX: o.v / 100 })
                    },
                    onComplete: () => {
                        const t = setTimeout(intro, 40 / INTRO_SPEED)
                        teardown.push(() => clearTimeout(t))
                    },
                })
                teardown.push(() => {
                    count.kill()
                })
            })
            .catch(err => {
                // never leave the page locked or invisible because a chunk failed
                console.warn('interaction layer failed to start', err)
                document.documentElement.classList.remove('preload', 'intro')
                document
                    .querySelectorAll('[data-fade],[data-reveal-lines]')
                    .forEach(el => el.classList.add('rv', 'shown'))
            })

        return () => {
            cancelled = true
            ac.abort()
            teardown.forEach(fn => {
                try {
                    fn()
                } catch {
                    /* nothing useful to do while unmounting */
                }
            })
        }
    }, [])

    /* ======================= per page ======================= */
    useEffect(() => {
        const state = shared.current
        if (previousPathname.current !== null && previousPathname.current !== pathname) hasNavigated.current = true
        previousPathname.current = pathname
        const arrivedByNavigation = hasNavigated.current

        const teardown: Array<() => void> = []
        let cancelled = false
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        const isTouch = matchMedia('(hover: none)').matches

        /* ---------- dim distance ----------
           the dim reaches 1 as the marquee reaches the top of the window; a page
           without one (/roadmap) sits at full dim throughout. */
        const marqueeEl = document.getElementById('marquee')
        const measureDim = () => {
            state.dimDistance = marqueeEl
                ? Math.max(1, marqueeEl.getBoundingClientRect().top + window.scrollY)
                : null
            state.updateDim()
        }
        measureDim()
        addEventListener('resize', measureDim)
        teardown.push(() => removeEventListener('resize', measureDim))

        void loadMotion().then(({ gsap, LocomotiveScroll }) => {
            if (cancelled) return
            const hero = document.querySelector('.hero')

            /* uScroll on the silk ramps 0 -> 1 as the hero leaves (silk backdrop only) */
            if (hero && state.silk) {
                const layers = state.silk
                const io = new IntersectionObserver(es => layers.setScroll(1 - es[0].intersectionRatio), {
                    threshold: Array.from({ length: 101 }, (_, i) => i / 100),
                })
                io.observe(hero)
                teardown.push(() => io.disconnect())
            }

            // line boxes first: locomotive measures element bounds when it is
            // constructed, and splitting changes them.
            splitLines(reduced)
            startMarquee(state, { reduced, isTouch, teardown })

            if (!reduced) {
                registerScrollReveals(Boolean(hero))
                const loco = new LocomotiveScroll({
                    lenisOptions: { duration: 1.25, easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) },
                    scrollCallback: v => {
                        state.scrollVelocity = Math.round(Math.abs(v.velocity)) // magnitude only
                        if (v.direction !== 0) state.scrollDirection = v.direction // sign is a separate flip
                    },
                })
                state.loco = loco
                teardown.push(() => {
                    loco.destroy()
                    if (state.loco === loco) state.loco = null
                })
            } else {
                document.querySelectorAll<HTMLElement>('[data-fade],[data-reveal-lines]').forEach(el => {
                    if (!el.closest('.hero')) el.classList.add('rv', 'shown')
                })
            }

            // reached by navigation, the home hero enters on its own; on a first
            // load the site-wide intro lands it in step with the loader
            if (hero && arrivedByNavigation) {
                const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
                tl.timeScale(INTRO_SPEED)
                addHeroEntrance(gsap, tl, { reduced, at: 0 })
                teardown.push(() => {
                    tl.kill()
                })
            }
        })

        return () => {
            cancelled = true
            teardown.forEach(fn => {
                try {
                    fn()
                } catch {
                    /* nothing useful to do while unmounting */
                }
            })
        }
    }, [pathname])

    // `#bg`, `#gl`, `#contours`, `#bgyt`, `#dim`, `.cursor-dot` and `.cursor-ring`
    // are the effect's own hooks. A canvas is a replaced element, so width:auto would
    // leave it at its intrinsic 300x150 - both need an explicit box, and 100lvh
    // covers the strip a retracting mobile toolbar vacates. #bg carries the
    // intro fade.
    return (
        <>
            <div id="bg" className="fixed top-0 left-0 z-0 h-[100lvh] w-full opacity-0">
                {VIDEO_BACKGROUND_ENABLED ? (
                    // The poster is a still of the video: it shows until the player is
                    // playing, under reduced motion, and if YouTube never loads.
                    // #bgyt is sized to cover the box at 16:9, then made 200px taller so
                    // the title bar YouTube pins to the player's top edge sits off-screen.
                    // It never takes a pointer, so no hover chrome ever appears.
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 overflow-hidden bg-[url(/bg-poster.jpg)] bg-cover bg-center"
                    >
                        <div
                            id="bgyt"
                            className="pointer-events-none absolute top-1/2 left-1/2 h-[calc(max(100lvh,56.25vw)+200px)] w-[max(100vw,177.78lvh)] -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-700 [&_iframe]:pointer-events-none [&_iframe]:h-full [&_iframe]:w-full"
                        >
                            <div id="bgyt-mount" />
                        </div>
                    </div>
                ) : (
                    <canvas id="gl" className="absolute inset-0 h-full w-full" />
                )}
                {!VIDEO_BACKGROUND_ENABLED && CONTOUR_BACKGROUND_ENABLED && (
                    <canvas
                        id="contours"
                        className="absolute inset-0 h-full w-full opacity-0 [filter:contrast(1.2)_saturate(1.3)]"
                    />
                )}
            </div>
            {/* the one dim layer for the whole site; see .dim in globals.css */}
            <div id="dim" className="dim pointer-events-none fixed top-0 left-0 z-[1] h-[100lvh] w-full" />
            <div className="cursor-dot pointer-events-none fixed top-0 left-0 z-[200] size-[5px] rounded-full bg-gold opacity-0 shadow-[0_0_10px_rgba(244,198,110,.7),0_0_24px_rgba(244,198,110,.3)] will-change-transform [@media(hover:none)]:hidden" />
            <div className="cursor-ring pointer-events-none fixed top-0 left-0 z-[200] size-[34px] rounded-full border border-[rgba(234,230,220,.35)] opacity-0 transition-[border-color] duration-[350ms] will-change-transform [&.is-link]:border-gold [@media(hover:none)]:hidden" />
        </>
    )
}

/* ======================= page pieces ======================= */

/** The hero's entrance, added to `tl` from `at`: headline first, everything else overlapping it. */
function addHeroEntrance(
    gsap: Gsap,
    tl: ReturnType<Gsap['timeline']>,
    { reduced, at }: { reduced: boolean; at: number }
): void {
    const heroMasks = () => document.querySelectorAll('.hero .mask')
    if (reduced) {
        gsap.set('.hero-title', { opacity: 1 })
        gsap.set('#hl-hot', { '--glow': 1 })
        gsap.set('.hero .mask>span', { yPercent: 0 })
        gsap.set('.hero [data-fade]', { opacity: 1, y: 0 })
        heroMasks().forEach(m => m.classList.add('open'))
        return
    }
    const litAt = at + (HERO_LIT_AT - HERO_RISE_AT)
    tl.to('.hero-title', { opacity: 1, duration: 0.8, ease: 'power2.out' }, at)
        .to(
            '.hero .mask>span',
            { yPercent: 0, duration: HERO_RISE_DURATION, stagger: HERO_STAGGER, ease: 'power4.out' },
            at
        )
        // the rest overlaps the headline instead of queueing behind it
        .to('.hero [data-fade]', { opacity: 1, y: 0, duration: 0.9, stagger: 0.07, ease: 'power3.out' }, at + 0.2)
        // the masks come off and the gold lights while the rise is still settling its last ~1.8%
        .call(() => heroMasks().forEach(m => m.classList.add('open')), undefined, litAt)
        .to('#hl-hot', { '--glow': 1, duration: 0.5, ease: 'power2.out' }, litAt)
}

/**
 * Tags every reveal on the page for locomotive. Re-run on each route, and the
 * footer persists across them, so each element's state is reset first.
 *
 * progress hits 1 only once an element has fully cleared the top of the
 * viewport - which anything in the last screenful can never do, so it would
 * sit permanently half-revealed. those get an end offset of 100%, which moves
 * the finish line to "element bottom reaches viewport bottom".
 */
function registerScrollReveals(hasHero: boolean): void {
    const docH = document.documentElement.scrollHeight
    document.querySelectorAll<HTMLElement>('[data-fade],[data-reveal-lines]').forEach(el => {
        if (el.closest('.hero')) return // hero belongs to its entrance timeline
        el.classList.remove('shown', 'tail')
        el.removeAttribute('data-scroll-offset')
        // a page with no hero (/roadmap) opens on content: whatever is already on
        // screen is shown, since it never gets to scroll in from below
        if (!hasHero && el.getBoundingClientRect().top < innerHeight) {
            el.classList.add('rv', 'shown')
            el.removeAttribute('data-scroll')
            el.querySelectorAll('.ln-mask,.mask').forEach(m => m.classList.add('open'))
            return
        }
        el.classList.add('rv')
        el.setAttribute('data-scroll', '')
        el.setAttribute('data-scroll-css-progress', '') // writes --progress
        el.setAttribute('data-scroll-event-progress', 'lsprog')
        const bottom = el.getBoundingClientRect().bottom + window.scrollY
        if (bottom > docH - innerHeight) {
            el.setAttribute('data-scroll-offset', '0,100%')
            el.classList.add('tail')
        }
    })
    // the markup carries the final value; only the scrubbed path rewinds it
    document.querySelectorAll<HTMLElement>('.count').forEach(el => {
        el.textContent = formatStatValue(Number(el.dataset.to), 0)
        el.setAttribute('data-scroll', '')
        el.setAttribute('data-scroll-event-progress', 'lsprog')
    })
}

/**
 * Marquee - fill the viewport, then mirror. translateX(-50%) only loops
 * seamlessly when each half is at least a screen wide, so the source set is
 * cloned until it covers the widest screen this window could reach.
 *
 * Same model locomotive's own rail uses: scroll magnitude only ever ADDS speed,
 * and the direction is a separate discrete flip taken from the scroll
 * direction - which multiplies the idle drift too, so once you have scrolled
 * the scroller keeps drifting whichever way you last went.
 */
function startMarquee(
    state: Shared,
    { reduced, isTouch, teardown }: { reduced: boolean; isTouch: boolean; teardown: Array<() => void> }
): void {
    const track = document.getElementById('mqtrack')
    if (!track) return
    const IDLE = 0.5
    // Touch scrolling is native momentum, not lenis' smoothed wheel, so a flick
    // reports velocities several times larger on a screen a fraction of the
    // width. On touch the boost is cut and capped.
    const GAIN = isTouch ? 0.25 : 0.8
    const MAXIMUM_BOOST = isTouch ? 4 : Infinity // px per frame at 60fps
    const RAIL = -1 // px per frame at 60fps

    const sets = [...track.querySelectorAll('.set')]
    sets.slice(1).forEach(el => el.remove()) // rebuild from one source
    const proto = sets[0]
    if (!proto) return
    const need = Math.max(innerWidth, screen.width || 0)
    for (let i = 0; i < 24 && track.scrollWidth < need; i++) track.appendChild(proto.cloneNode(true))
    const half = track.scrollWidth
    ;[...track.children].forEach(el => track.appendChild(el.cloneNode(true)))
    if (reduced) return

    let x = 0
    let raf = 0
    let last = performance.now()
    const step = (now: number) => {
        raf = requestAnimationFrame(step)
        const dt = Math.min(now - last, 100) / 1000
        last = now
        const dir = -state.scrollDirection * RAIL // -1 = leftward
        const speed = IDLE + Math.min(state.scrollVelocity * GAIN, MAXIMUM_BOOST) // always positive
        x -= dir * speed * dt * 60 // x up = leftward
        x = ((x % half) + half) % half // wrap both ways
        track.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px,0,0)'
    }
    raf = requestAnimationFrame(step)
    teardown.push(() => cancelAnimationFrame(raf))
}

/**
 * Splits each [data-reveal-lines] block into per-line masks. Where each line
 * breaks is measured from the live layout, so this runs after the webfont has
 * loaded. Idempotent per element, so re-running on a route change only splits
 * the new page.
 */
function splitLines(reduced: boolean): void {
    document.querySelectorAll<HTMLElement>('[data-reveal-lines]').forEach(el => {
        if (el.dataset.split === '1') return
        el.dataset.split = '1'
        const nodes = [...el.childNodes]
        el.innerHTML = ''
        const appendWord = (word: HTMLElement) => {
            word.classList.add('w')
            word.style.cssText += ';display:inline-block'
            el.appendChild(word)
        }
        nodes.forEach(node => {
            const tokens = (node.textContent ?? '').split(/(\s+)/)
            tokens.forEach(tok => {
                if (!tok) return
                if (/^\s+$/.test(tok)) {
                    el.appendChild(document.createTextNode(' '))
                    return
                }
                if (node.nodeType === Node.TEXT_NODE) {
                    const word = document.createElement('span')
                    word.textContent = tok
                    appendWord(word)
                } else if (node.nodeType === Node.ELEMENT_NODE) {
                    const word = node.cloneNode(false) as HTMLElement
                    word.textContent = tok
                    appendWord(word)
                }
            })
        })

        // group words into line masks
        const words = [...el.querySelectorAll<HTMLElement>('.w')]
        const lines: HTMLElement[][] = []
        let cur: HTMLElement[] = []
        let top: number | null = null
        words.forEach(w => {
            if (top === null || Math.abs(w.offsetTop - top) < 4) {
                cur.push(w)
                top = top === null ? w.offsetTop : top
            } else {
                lines.push(cur)
                cur = [w]
                top = w.offsetTop
            }
        })
        if (cur.length) lines.push(cur)
        lines.forEach(ws => {
            const mask = document.createElement('span')
            mask.className = 'ln-mask'
            const inner = document.createElement('span')
            inner.style.cssText = 'display:block'
            inner.className = 'line-inner'
            ws[0].before(mask)
            mask.appendChild(inner)
            ws.forEach((w, i) => {
                inner.appendChild(w)
                if (i < ws.length - 1) inner.appendChild(document.createTextNode(' '))
            })
        })

        // stagger index for transition-delay; the 115% start lives in CSS
        el.querySelectorAll<HTMLElement>('.line-inner').forEach((li, i) => li.style.setProperty('--i', String(i)))
        if (reduced) el.querySelectorAll('.ln-mask').forEach(m => m.classList.add('open'))
    })
}
