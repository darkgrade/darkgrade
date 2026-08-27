/**
 * Scroll-reactive ticker. One source `.set` is authored here; the marquee
 * driver in <SiteEffects> clones it until it covers the viewport, mirrors the
 * run, and translates it. `#mqtrack` and `.set` are its hooks.
 */
const PAIRS: [persona: string, medium: string][] = [
    ['Creators', 'YouTube'],
    ['YouTubers', 'Reels'],
    ['Podcasters', 'Shorts'],
    ['Agencies', 'TikTok'],
    ['Studios', 'Livestreams'],
]

function Star() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="size-3 shrink-0 text-gold [filter:drop-shadow(0_0_calc(5px*var(--gI))_rgba(244,198,110,.5))]"
        >
            <path d="M12 0l2.6 9.4L24 12l-9.4 2.6L12 24l-2.6-9.4L0 12l9.4-2.6z" />
        </svg>
    )
}

export function Marquee() {
    return (
        <div
            aria-hidden="true"
            className="relative flex h-[var(--mq-h)] items-center overflow-hidden border-y border-hair bg-[rgba(10,10,11,.35)]"
        >
            <div id="mqtrack" className="flex w-max will-change-transform">
                <div className="set flex shrink-0 items-center">
                    {PAIRS.map(([persona, medium]) => (
                        <span key={persona} className="flex items-center gap-[44px] pr-[44px] whitespace-nowrap">
                            <span className="font-serif text-[18px] leading-[1.2] text-ink italic">{persona}</span>
                            <Star />
                            <span className="font-serif text-[18px] leading-[1.2] text-ink-35">{medium}</span>
                            <Star />
                        </span>
                    ))}
                </div>
            </div>
        </div>
    )
}
