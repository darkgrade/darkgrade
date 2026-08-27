import { BTN_GHOST, BTN_SOLID, LABEL, LINKS } from './site-links'

export function Hero() {
    return (
        // `hero` is a JS hook: the shader watches it to ramp uScroll, and the
        // intro timeline animates the masks and [data-fade] children inside it.
        <section className="hero relative flex min-h-[calc(100dvh_-_var(--mq-h))] flex-col justify-end pb-[clamp(56px,8vh,100px)]">
            <div className="shell">
                <div className="mb-[clamp(20px,3vh,36px)] flex items-center gap-4" data-fade>
                    <span className="glow-line h-px w-[56px] bg-gold" />
                    <span className={`${LABEL} text-ink-55`}>Local-first AI for creative professionals</span>
                </div>

                <h1
                    aria-label="Shoot more. Edit less."
                    className="hero-title ml-[-.04em] font-serif text-[clamp(74px,12.6vw,196px)] leading-[.94] font-normal tracking-[-.015em]"
                >
                    <span className="mask" data-reveal>
                        <span>Shoot more.</span>
                    </span>
                    <span className="mask" data-reveal>
                        <span>
                            Edit{' '}
                            <span id="hl-hot" className="glow-ramp tracking-normal italic">
                                less.
                            </span>
                        </span>
                    </span>
                </h1>

                <p
                    className="mt-[clamp(22px,3.4vh,40px)] max-w-[47ch] text-[clamp(15.5px,1.25vw,18.5px)] leading-[1.65] font-[340] text-ink-55"
                    data-fade
                >
                    Darkgrade dials in your camera, captures the shot, and returns a finished first cut —{' '}
                    <b className="font-[460] text-ink">on your own machine.</b> You stay the director, and nothing
                    leaves your computer unless you say so.
                </p>

                <div className="mt-[clamp(26px,4vh,46px)] flex flex-wrap items-center gap-[18px]" data-fade>
                    <a className={BTN_SOLID} href={LINKS.youtube} target="_blank" rel="noopener">
                        <span>Watch it in action</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M5 3l14 9-14 9V3z" />
                        </svg>
                    </a>
                    <a className={BTN_GHOST} href={LINKS.discord} target="_blank" rel="noopener">
                        <span>Join the Discord</span>
                    </a>
                </div>

                <div className="mt-[clamp(40px,7vh,84px)] flex items-end justify-between" data-fade>
                    <div className="flex items-center gap-[14px] text-[10.5px] tracking-[.3em] text-ink-35 uppercase">
                        <span>Scroll</span>
                        <span className="glow-line relative h-[44px] w-px overflow-hidden bg-hair after:absolute after:top-0 after:left-0 after:h-full after:w-full after:animate-drip after:bg-gold after:shadow-[0_0_10px_rgba(244,198,110,.6)] after:content-['']" />
                    </div>
                    <div className="text-right font-mono text-[11px] tracking-[.12em] text-ink-35 max-[700px]:hidden">
                        TESTED ON
                        <br />
                        <b className="font-medium text-ink-55">SONY α7 IV · NIKON Z6 III · CANON R6 MK III</b>
                    </div>
                </div>
            </div>
        </section>
    )
}
