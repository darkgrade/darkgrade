'use client'

import { useEffect } from 'react'

import { getBgMode, setBgMode, subscribeBgMode } from './background-mode'
import { createBackgrounds } from './backgrounds'
import { CONTOUR_BACKGROUND_ENABLED } from './backgrounds/field'

/**
 * Every moving part of the page: the WebGL silk backdrop, the GSAP preloader
 * and intro, the custom cursor, Locomotive's scrubbed scroll reveals, the
 * scroll-reactive marquee, line splitting, the stat counters and the npm copy
 * button. All of it is torn down again on unmount, so a StrictMode double
 * effect in development leaves nothing running twice.
 */
export function SiteEffects() {
    useEffect(() => {
        const ac = new AbortController()
        const signal = ac.signal
        const teardown: Array<() => void> = []
        let cancelled = false

        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        const isTouch = matchMedia('(hover: none)').matches

        /* ============ THE LAMP ============
           --gI is a static intensity knob set once in CSS. it used to be driven
           per frame from here, which invalidated style for the whole document
           60x/sec - every calc(Npx*var(--gI)) had to be re-resolved and
           repainted. it is still one number: turn the glow up or down in
           :root and everything follows. */

        /* ============ backdrops ============
           two renderers, one clock: the silk shader and the topographic
           contours the site used to run. The header toggle cross-fades between
           them; because neither keeps its own elapsed time, a layer that has
           been parked while faded out resumes in phase rather than restarting. */
        const silkCanvas = document.getElementById('gl') as HTMLCanvasElement | null
        const contourCanvas = document.getElementById('contours') as HTMLCanvasElement | null
        let bg: ReturnType<typeof createBackgrounds> | null = null

        if (silkCanvas) {
            bg = createBackgrounds(silkCanvas, contourCanvas)
            const layers = bg
            teardown.push(() => layers.destroy())

            // no WebGL? the contours are a complete background on their own
            if (CONTOUR_BACKGROUND_ENABLED && !layers.silkAvailable && getBgMode() === 'silk') setBgMode('contours')
            layers.setMode(getBgMode())
            teardown.push(subscribeBgMode(m => layers.setMode(m)))

            // the CSS box depends on env() insets, which can change without a
            // resize event (orientation, toolbar, safe-area recalcs). watch the
            // element itself so neither drawing buffer can drift from what is
            // actually painted.
            if ('ResizeObserver' in window) {
                const ro = new ResizeObserver(() => layers.resize())
                ro.observe(silkCanvas)
                teardown.push(() => ro.disconnect())
            } else {
                addEventListener('resize', () => layers.resize(), { signal })
                addEventListener('orientationchange', () => layers.resize(), { signal })
            }

            addEventListener('pointermove', e => layers.setPointer(e.clientX, e.clientY), { signal })

            // uScroll ramps 0 -> 1 as the hero leaves. an observer reports the
            // hero's visible fraction directly, so nothing here ever reads
            // scroll position: 1 - ratio tracks scrollY/heroHeight, and the hero
            // is always shorter than the viewport so the ratio spans 1 -> 0.
            const heroEl = document.querySelector('.hero')
            if (heroEl && 'IntersectionObserver' in window) {
                const io = new IntersectionObserver(es => layers.setScroll(1 - es[0]!.intersectionRatio), {
                    threshold: Array.from({ length: 101 }, (_, i) => i / 100),
                })
                io.observe(heroEl)
                teardown.push(() => io.disconnect())
            }

            // full rate everywhere; only a hidden tab stops it
            document.addEventListener('visibilitychange', () => (document.hidden ? layers.stop() : layers.start()), {
                signal,
            })
            layers.start()
        }

        let scrollVel = 0
        let scrollRawDir = 1 // from lenis, drives the marquee

        /* ============ marquee - fill the viewport, then mirror ============
           translateX(-50%) only loops seamlessly when each half is at least a
           screen wide. after the scroller shrank 40%, one half no longer was, so
           the run ended and left dead space. clone the source set until it
           covers the widest screen this window could reach, then mirror. */
        {
            const track = document.getElementById('mqtrack')
            if (track) {
                // Same model locomotive's own rail uses: scroll magnitude only
                // ever ADDS speed, and the direction is a separate discrete flip
                // taken from the scroll direction - which multiplies the idle
                // drift too, so once you have scrolled the scroller keeps
                // drifting whichever way you last went. Never decelerates
                // through zero to turn around; it just changes sign and speeds up.
                const IDLE = 0.5
                const GAIN = 0.8
                const RAIL = -1 // px per frame at 60fps
                const drive = (half: number) => {
                    let x = 0
                    let mqRaf = 0
                    let last = performance.now()
                    const step = (now: number) => {
                        mqRaf = requestAnimationFrame(step)
                        const dt = Math.min(now - last, 100) / 1000
                        last = now
                        const dir = -scrollRawDir * RAIL // -1 = leftward
                        const speed = IDLE + scrollVel * GAIN // always positive
                        x -= dir * speed * dt * 60 // x up = leftward
                        x = ((x % half) + half) % half // wrap both ways
                        track.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px,0,0)'
                    }
                    mqRaf = requestAnimationFrame(step)
                    teardown.push(() => cancelAnimationFrame(mqRaf))
                }
                const build = () => {
                    if (cancelled) return
                    const sets = [...track.querySelectorAll('.set')]
                    sets.slice(1).forEach(el => el.remove()) // rebuild from one source
                    const proto = sets[0]
                    if (!proto) return
                    const need = Math.max(innerWidth, screen.width || 0)
                    for (let i = 0; i < 24 && track.scrollWidth < need; i++) track.appendChild(proto.cloneNode(true))
                    const half = track.scrollWidth
                    ;[...track.children].forEach(el => track.appendChild(el.cloneNode(true)))
                    if (reduced) return
                    drive(half)
                }
                // widths depend on the webfont, and it loads with font-display:swap
                const ready = document.fonts?.ready ?? Promise.resolve()
                ready.then(build).catch(build)
            }
        }

        /* ============ split lines for [data-reveal-lines] ============
           where each line breaks is measured from the live layout, so this has
           to wait for the webfont: measuring against the fallback groups the
           words wrongly and nothing ever re-measures. */
        const splitLines = () => {
            document.querySelectorAll<HTMLElement>('[data-reveal-lines]').forEach(el => {
                if (el.dataset.split === '1') return // idempotent under StrictMode
                el.dataset.split = '1'
                const nodes = [...el.childNodes]
                el.innerHTML = ''
                const rebuild = (node: ChildNode) => {
                    const tokens = (node.textContent ?? '').split(/(\s+)/)
                    if (node.nodeType === 3) {
                        tokens.forEach(tok => {
                            if (!tok) return
                            if (/^\s+$/.test(tok)) {
                                el.appendChild(document.createTextNode(' '))
                                return
                            }
                            const w = document.createElement('span')
                            w.className = 'w'
                            w.textContent = tok
                            w.style.cssText = 'display:inline-block'
                            el.appendChild(w)
                        })
                    } else if (node.nodeType === 1) {
                        tokens.forEach(tok => {
                            if (!tok) return
                            if (/^\s+$/.test(tok)) {
                                el.appendChild(document.createTextNode(' '))
                                return
                            }
                            const clone = node.cloneNode(false) as HTMLElement
                            clone.textContent = tok
                            clone.style.cssText += ';display:inline-block'
                            clone.classList.add('w')
                            el.appendChild(clone)
                        })
                    }
                }
                nodes.forEach(rebuild)

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
                    ws[0]!.before(mask)
                    mask.appendChild(inner)
                    ws.forEach((w, i) => {
                        inner.appendChild(w)
                        if (i < ws.length - 1) inner.appendChild(document.createTextNode(' '))
                    })
                })

                // stagger index for transition-delay; the 115% start lives in CSS
                el.querySelectorAll<HTMLElement>('.line-inner').forEach((li, i) =>
                    li.style.setProperty('--i', String(i))
                )
                if (reduced) el.querySelectorAll('.ln-mask').forEach(m => m.classList.add('open'))
            })
        }

        /* ============ scroll progress consumers ============
           one listener for everything locomotive scrubs: masks reopen so the
           glow can bleed once a block has fully landed, and the stat counters
           read straight off progress instead of firing a tween. */
        const fmt = (el: HTMLElement, v: number) => {
            const to = Number(el.dataset.to)
            const n = Math.round(v * to)
            el.textContent = to === 20 ? Math.round(n / 2) + '–' + n : String(n)
        }
        addEventListener(
            'lsprog',
            evt => {
                const { target, progress } = (evt as CustomEvent<{ target: HTMLElement; progress: number }>).detail
                if (target.classList.contains('count')) {
                    // same band the reveals use, so a stat lands with its row
                    fmt(target, Math.min(1, Math.max(0, (progress - 0.1) / 0.28)))
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
        if (hdr && mark && 'IntersectionObserver' in window) {
            const io = new IntersectionObserver(es => hdr.classList.toggle('scrolled', !es[0]!.isIntersecting))
            io.observe(mark)
            teardown.push(() => io.disconnect())
        }

        /* ============ npm copy ============ */
        document.querySelectorAll<HTMLElement>('[data-copy]').forEach(el => {
            el.addEventListener(
                'click',
                () => {
                    const txt = el.dataset.copy ?? ''
                    const done = () => {
                        const c = el.querySelector<HTMLElement>('.copy')
                        if (!c) return
                        const old = c.textContent
                        c.textContent = 'COPIED ✓'
                        c.style.color = 'var(--color-gold)'
                        setTimeout(() => {
                            c.textContent = old
                            c.style.color = ''
                        }, 1600)
                    }
                    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(done)
                    else done()
                },
                { signal }
            )
        })

        /* ============ smooth scroll, reveals, cursor and intro ============
           gsap and locomotive both touch window at import time, so they load
           here rather than at module scope. */
        void (async () => {
            const [gsapMod, locoMod] = await Promise.all([
                import('gsap'),
                import('locomotive-scroll'),
                document.fonts?.ready ?? Promise.resolve(),
            ])
            if (cancelled) return
            // line boxes first: locomotive measures element bounds when it is
            // constructed, and splitting changes them.
            splitLines()
            const gsap = gsapMod.gsap
            const LocomotiveScroll = locoMod.default

            let loco: InstanceType<typeof LocomotiveScroll> | null = null
            if (!reduced) {
                // progress hits 1 only once an element has fully cleared the top
                // of the viewport - which anything in the last screenful can
                // never do, so it would sit permanently half-revealed. those get
                // an end offset of 100%, which moves the finish line to "element
                // bottom reaches viewport bottom" - always reachable, because
                // every element's bottom is inside the document.
                const docH = document.documentElement.scrollHeight
                const wS = innerHeight
                document.querySelectorAll<HTMLElement>('[data-fade],[data-reveal-lines]').forEach(el => {
                    if (el.closest('.hero')) return // hero belongs to the intro timeline
                    el.classList.add('rv')
                    el.setAttribute('data-scroll', '')
                    el.setAttribute('data-scroll-css-progress', '') // writes --progress
                    el.setAttribute('data-scroll-event-progress', 'lsprog')
                    const bottom = el.getBoundingClientRect().bottom + window.scrollY
                    if (bottom > docH - wS) {
                        el.setAttribute('data-scroll-offset', '0,100%')
                        el.classList.add('tail')
                    }
                })
                document.querySelectorAll('.count').forEach(el => {
                    el.setAttribute('data-scroll', '')
                    el.setAttribute('data-scroll-event-progress', 'lsprog')
                })
                loco = new LocomotiveScroll({
                    lenisOptions: { duration: 1.25, easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) },
                    scrollCallback: v => {
                        scrollVel = Math.round(Math.abs(v.velocity)) // magnitude only
                        if (v.direction !== 0) scrollRawDir = v.direction // sign is a separate flip
                    },
                })
                const instance = loco
                teardown.push(() => instance.destroy())
            } else {
                document.querySelectorAll<HTMLElement>('[data-fade],[data-reveal-lines]').forEach(el => {
                    if (!el.closest('.hero')) el.classList.add('rv', 'shown')
                })
            }

            /* ---------- cursor ---------- */
            if (!isTouch) {
                const dot = document.querySelector<HTMLElement>('.cursor-dot')
                const ring = document.querySelector<HTMLElement>('.cursor-ring')
                if (dot && ring) {
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
                    document.querySelectorAll('a,button,.act,.npmline,.horizon').forEach(el => {
                        el.addEventListener(
                            'pointerenter',
                            () => {
                                ring.classList.add('is-link')
                                gsap.to(ring, { scale: 56 / 34, duration: 0.35, ease: 'power3.out', overwrite: 'auto' })
                            },
                            { signal }
                        )
                        el.addEventListener(
                            'pointerleave',
                            () => {
                                ring.classList.remove('is-link')
                                gsap.to(ring, { scale: 1, duration: 0.35, ease: 'power3.out', overwrite: 'auto' })
                            },
                            { signal }
                        )
                    })
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
            }

            /* ---------- in-page links ----------
               anchors scroll through lenis instead of hard-jumping. bare "#"
               (the logo) goes to the top; anything pointing at a real id scrolls
               to that element. external hrefs fall straight through. */
            document.addEventListener(
                'click',
                e => {
                    const a = (e.target as Element | null)?.closest?.('a[href^="#"]')
                    if (!a) return
                    const href = a.getAttribute('href')
                    if (!href) return
                    const target: Element | 0 | null = href === '#' ? 0 : document.querySelector(href)
                    if (target === null) return // dead anchor, leave it alone
                    e.preventDefault()
                    if (loco) loco.scrollTo(target as HTMLElement | number, { duration: 1.4 })
                    else if (target === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
                    else target.scrollIntoView({ behavior: 'smooth' })
                },
                { signal }
            )

            /* ---------- preloader + intro ---------- */
            const loader = document.getElementById('loader')
            const lnum = document.getElementById('lnum')
            const lbar = document.getElementById('lbar')
            // one span per digit, so the count never reflows - see <Loader>
            const digits = lnum ? [...lnum.querySelectorAll<HTMLElement>('span')] : []
            const showCount = (v: number) => {
                const s = String(Math.round(v)).padStart(3, '0')
                if (!digits.length) {
                    if (lnum) lnum.textContent = s
                    return
                }
                digits.forEach((d, i) => (d.textContent = s[i] ?? '0'))
            }
            const heroMasks = () => document.querySelectorAll('.hero .mask')

            const intro = () => {
                document.documentElement.classList.remove('preload')
                const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
                teardown.push(() => tl.kill())
                // every beat starts before the one before it finishes, so the
                // whole thing reads as one move rather than a queue
                tl.to(loader, { yPercent: -100, duration: 0.9, ease: 'power3.inOut' }, 0)
                    .set(loader, { display: 'none' })
                    .to('#bg', { opacity: 1, duration: 1.3, ease: 'power2.inOut' }, 0.2)
                if (bg) tl.to(bg.intro, { value: 1, duration: 1.6, ease: 'power2.inOut' }, 0.2)
                if (!reduced) {
                    // the headline lands first and alone - everything else
                    // follows it in. loader is clear at .9; the headline picks
                    // it straight up
                    tl.to('.hero-title', { opacity: 1, duration: 0.8, ease: 'power2.out' }, 0.95)
                        .to(
                            '.hero .mask>span',
                            { yPercent: 0, duration: 0.85, stagger: 0.05, ease: 'power4.out' },
                            0.95
                        )
                        // the rest overlaps the headline instead of queueing behind it
                        .to(
                            '.hero [data-fade]',
                            { opacity: 1, y: 0, duration: 0.9, stagger: 0.07, ease: 'power3.out' },
                            1.15
                        )
                        .from('#hdr', { y: -30, opacity: 0, duration: 0.7, ease: 'power3.out' }, 1.35)
                        // power4.out leaves both lines ~1.5% from home by 1.55,
                        // so the masks open and the glow starts while the rise
                        // is still finishing
                        .call(() => heroMasks().forEach(m => m.classList.add('open')), undefined, 1.55)
                        .to('#hl-hot', { '--glow': 1, duration: 0.7, ease: 'power2.out' }, 1.55)
                } else {
                    gsap.set('.hero-title', { opacity: 1 })
                    gsap.set('#hl-hot', { '--glow': 1 })
                    gsap.set('.hero .mask>span', { yPercent: 0 })
                    gsap.set('.hero [data-fade]', { opacity: 1, y: 0 })
                    heroMasks().forEach(m => m.classList.add('open'))
                }
            }

            if (reduced) {
                showCount(100)
                intro()
            } else {
                const o = { v: 0 }
                const count = gsap.to(o, {
                    v: 100,
                    duration: 1,
                    ease: 'power2.inOut',
                    onUpdate: () => {
                        showCount(o.v)
                        if (lbar) gsap.set(lbar, { scaleX: o.v / 100 })
                    },
                    onComplete: () => {
                        const t = setTimeout(intro, 40)
                        teardown.push(() => clearTimeout(t))
                    },
                })
                teardown.push(() => count.kill())
            }
        })().catch(err => {
            // never leave the page locked or invisible because a chunk failed
            console.warn('interaction layer failed to start', err)
            document.documentElement.classList.remove('preload')
            document.querySelectorAll('[data-fade],[data-reveal-lines]').forEach(el => el.classList.add('rv', 'shown'))
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

    // `#bg`, `#gl`, `#contours`, `.cursor-dot` and `.cursor-ring` are the
    // effect's own hooks. A canvas is a replaced element, so width:auto would
    // leave it at its intrinsic 300x150 - both need an explicit box, and 100lvh
    // covers the strip a retracting mobile toolbar vacates. #bg carries the
    // intro fade; the two canvases inside it carry the cross-fade.
    return (
        <>
            <div id="bg" className="fixed top-0 left-0 z-0 h-[100lvh] w-full opacity-0">
                <canvas id="gl" className="absolute inset-0 h-full w-full" />
                {CONTOUR_BACKGROUND_ENABLED && (
                    <canvas
                        id="contours"
                        className="absolute inset-0 h-full w-full opacity-0 [filter:contrast(1.2)_saturate(1.3)]"
                    />
                )}
            </div>
            <div className="pointer-events-none fixed top-0 left-0 z-[1] h-[100lvh] w-full bg-[radial-gradient(120%_90%_at_50%_40%,transparent_55%,rgba(0,0,0,.5)_100%)]" />
            <div className="cursor-dot pointer-events-none fixed top-0 left-0 z-[200] size-[5px] rounded-full bg-gold opacity-0 shadow-[0_0_10px_rgba(244,198,110,.7),0_0_24px_rgba(244,198,110,.3)] will-change-transform [@media(hover:none)]:hidden" />
            <div className="cursor-ring pointer-events-none fixed top-0 left-0 z-[200] size-[34px] rounded-full border border-[rgba(234,230,220,.35)] opacity-0 transition-[border-color] duration-[350ms] will-change-transform [&.is-link]:border-gold [@media(hover:none)]:hidden" />
        </>
    )
}
