import { StarIcon } from './star-icon'

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
        <StarIcon className="size-3 shrink-0 text-gold [filter:drop-shadow(0_0_calc(5px*var(--gI))_rgba(244,198,110,.5))]" />
    )
}

export function Marquee() {
    return (
        <div
            id="marquee"
            aria-hidden="true"
            className="relative flex h-[var(--mq-h)] items-center overflow-hidden panel"
        >
            <div id="mqtrack" className="flex w-max will-change-transform">
                <div className="set flex shrink-0 items-center">
                    {PAIRS.map(([persona, medium]) => (
                        <span key={persona} className="flex items-center gap-[44px] pr-[44px] whitespace-nowrap">
                            <span className="font-serif text-[1.125rem] leading-[1.2] text-ink italic">{persona}</span>
                            <Star />
                            <span className="font-serif text-[1.125rem] leading-[1.2] text-ink-52">{medium}</span>
                            <Star />
                        </span>
                    ))}
                </div>
            </div>
        </div>
    )
}
