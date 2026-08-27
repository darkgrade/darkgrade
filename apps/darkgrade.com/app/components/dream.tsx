import { BTN_GHOST, BTN_SOLID, LABEL, LINKS } from './site-links'

export function Dream() {
    return (
        <section className="relative py-[clamp(140px,22vh,280px)] text-center">
            <div className="shell">
                <div className={`${LABEL} mb-[34px] text-ink-55`} data-fade>
                    <span className="mr-[14px] text-gold">04</span>The point of all this
                </div>

                <h2
                    className="mx-auto max-w-[24ch] font-serif text-[clamp(34px,4.6vw,68px)] leading-[1.25] font-normal tracking-[-.005em]"
                    data-reveal-lines
                >
                    Somewhere, two people have a podcast in their heads{' '}
                    <span className="text-ink-35">the world will never hear.</span>
                </h2>

                <div className="will-change-[transform,opacity]" data-fade>
                    <span
                        id="d-punch"
                        className="glow-hot mx-auto mt-[clamp(28px,5vh,54px)] block max-w-[19ch] font-serif text-[clamp(32px,4.4vw,68px)] leading-[1.12] italic will-change-transform"
                    >
                        The world is still waiting on what you haven’t made yet.
                    </span>
                </div>

                <div className="mt-[clamp(40px,7vh,72px)] flex flex-wrap justify-center gap-[18px]" data-fade>
                    <a className={BTN_SOLID} href={LINKS.youtube} target="_blank" rel="noopener">
                        <span>Watch it in action</span>
                    </a>
                    <a className={BTN_GHOST} href={LINKS.github} target="_blank" rel="noopener">
                        <span>Star on GitHub</span>
                        <span className="text-gold">✦</span>
                    </a>
                </div>
            </div>
        </section>
    )
}
