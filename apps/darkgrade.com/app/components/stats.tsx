import { Fragment } from 'react'

import { LINKS } from './site-links'

/**
 * The text one number of a stat shows at `fraction` (0..1) of its scrub.
 * Shared with the scroll consumer in <SiteEffects> so the server-rendered final
 * value and the animated one can never disagree.
 */
export function formatStatValue(to: number, fraction: number) {
    return String(Math.round(fraction * to))
}

/** `data-to` is read by the scroll-progress consumer in <SiteEffects>, which
 *  scrubs each number as its row lands. `.count` is that hook. The markup
 *  carries the final value, so without JavaScript, under reduced motion and
 *  for screen readers the stat is always the true one. */
const STATS = [
    { values: [10, 20], unit: 'hrs', caption: 'of post-production per video, cut down to minutes.' },
    { values: [25], unit: 'yrs', caption: 'cameras have spoken one shared language.' },
    { values: [0], unit: 'bytes', caption: 'leave your machine by default.' },
    {
        values: [100],
        unit: '%',
        caption: 'of our code is licensed as fair core.',
        link: { label: 'Read the code on GitHub', href: LINKS.github },
    },
]

/** The number is as wide as its final value from the start (an invisible copy sets the
 *  width) and the counting digits sit on top, left-aligned. The face has proportional
 *  digits and no tabular figures, so without this the unit beside it slid sideways
 *  with every step of the count. */
function Digits({ to }: { to: number }) {
    return (
        <span className="relative inline-block">
            <span className="invisible">{formatStatValue(to, 1)}</span>
            <span className="count absolute top-0 left-0 whitespace-nowrap" data-to={to}>
                {formatStatValue(to, 1)}
            </span>
        </span>
    )
}

export function Stats() {
    return (
        <section className="shell pb-[clamp(100px,14vh,180px)]">
            <div className="grid grid-cols-4 max-[900px]:grid-cols-2">
                {STATS.map(({ values, unit, caption, link }) => (
                    <div key={unit} data-fade className="relative px-[clamp(24px,3vw,56px)] py-[clamp(44px,6vh,72px)]">
                        <div className="font-serif text-[clamp(2.75rem,4.6vw,4.75rem)] leading-none tracking-[-.01em]">
                            {/* the scrubbing digits are hidden from screen readers, which get the final value once */}
                            <span className="sr-only">
                                {values.join('–')} {unit}
                            </span>
                            <span aria-hidden="true">
                                {/* the number never breaks (a "10–20" range split at its dash reads as a bug); on the narrowest
                                    screens the unit drops to its own line instead */}
                                <span className="whitespace-nowrap">
                                    {values.map((to, index) => (
                                        <Fragment key={to}>
                                            {index > 0 && (
                                                // an en dash drawn in CSS: Flapjack has no U+2013, so the glyph
                                                // would fall back to a system face at this size
                                                <span className="mx-[.12em] inline-block h-[.05em] w-[.4em] bg-current align-middle" />
                                            )}
                                            <Digits to={to} />
                                        </Fragment>
                                    ))}
                                </span>
                                <i className="glow-sm text-[.55em] italic max-[480px]:mt-1 max-[480px]:block">
                                    <span className="max-[480px]:hidden">&nbsp;</span>
                                    {unit}
                                </i>
                            </span>
                        </div>
                        <div className="mt-4 max-w-[24ch] text-label leading-[1.55] tracking-[.05em] text-ink-55">
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
