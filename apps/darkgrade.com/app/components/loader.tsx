import { Wordmark } from './wordmark'

/**
 * Preloader. Shown only under html.intro, which the root layout sets when a
 * visit lands on the home page - so it is hidden outright without JavaScript
 * (nothing would ever lift it) and on every other entry point. The intro
 * timeline in <SiteEffects> counts it up, then slides it away.
 */
export function Loader() {
    return (
        <div
            id="loader"
            aria-hidden="true"
            className="fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-[26px] bg-[#060607] [html.intro_&]:flex"
        >
            <div className="opacity-[.72]">
                <Wordmark className="block h-[15px] w-auto text-ink-55" />
            </div>
            {/* Display faces rarely ship tabular figures, so font-feature-settings:'tnum'
                can't be relied on, and proportional digits vary widely in width -
                enough to slide the whole centred block every frame. One fixed
                cell per digit instead: 1ch is the advance of '0', i.e. the
                widest digit, so nothing overflows and the width never changes. */}
            <div className="font-serif text-[clamp(4rem,10vw,7.5rem)] leading-none text-ink">
                <span id="lnum">
                    {[0, 1, 2].map(i => (
                        <span key={i} className="inline-block w-[1ch] text-center">
                            0
                        </span>
                    ))}
                </span>
                <i className="glow-hot italic">%</i>
            </div>
            <div className="glow-line relative h-px w-[min(260px,50vw)] bg-hair">
                <b id="lbar" className="glow-line absolute inset-0 origin-left scale-x-0 bg-gold" />
            </div>
        </div>
    )
}
