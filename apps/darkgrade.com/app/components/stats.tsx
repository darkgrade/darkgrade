/** `data-to` is read by the scroll-progress consumer in <SiteEffects>, which
 *  scrubs each number as its row lands. `.count` is that hook. */
const STATS = [
    { to: 20, unit: 'hrs', caption: 'of post-production per video, cut down to minutes.' },
    { to: 25, unit: 'yrs', caption: 'cameras have spoken one shared language.' },
    { to: 0, unit: 'bytes', caption: 'leave your machine by default.' },
    { to: 100, unit: '%', caption: 'of our code is licensed as fair core. View it on GitHub.' },
]

export function Stats() {
    return (
        <section className="shell pb-[clamp(100px,14vh,180px)]">
            <div className="grid grid-cols-4 border-y border-hair max-[900px]:grid-cols-2">
                {STATS.map(({ to, unit, caption }) => (
                    <div
                        key={unit}
                        data-fade
                        className="relative border-l border-hair px-[clamp(24px,3vw,56px)] py-[clamp(44px,6vh,72px)] first:border-l-0 max-[900px]:border-t max-[900px]:[&:nth-child(-n+2)]:border-t-0 max-[900px]:[&:nth-child(3)]:border-l-0"
                    >
                        <div className="font-serif text-[clamp(2.75rem,4.6vw,4.75rem)] leading-none tracking-[-.01em]">
                            <span className="count whitespace-nowrap" data-to={to}>
                                0
                            </span>
                            {/* the number never breaks (a "10–20" range split at its dash reads as a bug); on the narrowest
                                screens the unit drops to its own line instead */}
                            <i className="glow-sm text-[.55em] italic max-[480px]:mt-1 max-[480px]:block">
                                <span className="max-[480px]:hidden">&nbsp;</span>
                                {unit}
                            </i>
                        </div>
                        <div className="mt-4 max-w-[24ch] text-[0.7812rem] leading-[1.55] tracking-[.05em] text-ink-55">
                            {caption}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}
