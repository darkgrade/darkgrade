import { LINKS } from './site-links'

/**
 * The text a stat shows at `fraction` (0..1) of its scrub. Shared with the
 * scroll consumer in <SiteEffects> so the server-rendered final value and the
 * animated one can never disagree.
 */
export function formatStatValue(to: number, fraction: number) {
    const value = Math.round(fraction * to)
    return to === 20 ? `${Math.round(value / 2)}–${value}` : String(value)
}

/** `data-to` is read by the scroll-progress consumer in <SiteEffects>, which
 *  scrubs each number as its row lands. `.count` is that hook. The markup
 *  carries the final value, so without JavaScript, under reduced motion and
 *  for screen readers the stat is always the true one. */
const STATS = [
    { to: 20, unit: 'hrs', caption: 'of post-production per video, cut down to minutes.' },
    { to: 25, unit: 'yrs', caption: 'cameras have spoken one shared language.' },
    { to: 0, unit: 'bytes', caption: 'leave your machine by default.' },
    {
        to: 100,
        unit: '%',
        caption: 'of our code is licensed as fair core.',
        link: { label: 'Read the code on GitHub', href: LINKS.github },
    },
]

export function Stats() {
    return (
        <section className="shell pb-[clamp(100px,14vh,180px)]">
            <div className="grid grid-cols-4 border-y border-hair max-[900px]:grid-cols-2">
                {STATS.map(({ to, unit, caption, link }) => (
                    <div
                        key={unit}
                        data-fade
                        className="relative border-l border-hair px-[clamp(24px,3vw,56px)] py-[clamp(44px,6vh,72px)] first:border-l-0 max-[900px]:border-t max-[900px]:[&:nth-child(-n+2)]:border-t-0 max-[900px]:[&:nth-child(3)]:border-l-0"
                    >
                        <div className="font-serif text-[clamp(2.75rem,4.6vw,4.75rem)] leading-none tracking-[-.01em]">
                            {/* the scrubbing digits are hidden from screen readers, which get the final value once */}
                            <span className="sr-only">
                                {formatStatValue(to, 1)} {unit}
                            </span>
                            <span aria-hidden="true">
                                <span className="count whitespace-nowrap" data-to={to}>
                                    {formatStatValue(to, 1)}
                                </span>
                                {/* the number never breaks (a "10–20" range split at its dash reads as a bug); on the narrowest
                                    screens the unit drops to its own line instead */}
                                <i className="glow-sm text-[.55em] italic max-[480px]:mt-1 max-[480px]:block">
                                    <span className="max-[480px]:hidden">&nbsp;</span>
                                    {unit}
                                </i>
                            </span>
                        </div>
                        <div className="mt-4 max-w-[24ch] text-[0.7812rem] leading-[1.55] tracking-[.05em] text-ink-55">
                            {caption}
                            {link && (
                                <>
                                    {' '}
                                    <a
                                        href={link.href}
                                        target="_blank"
                                        rel="noopener"
                                        className="text-ink underline decoration-ink-52 underline-offset-[3px] transition-colors duration-300 hover:text-gold hover:decoration-gold"
                                    >
                                        {link.label}
                                    </a>
                                </>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}
