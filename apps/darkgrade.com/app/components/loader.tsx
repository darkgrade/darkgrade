import { Wordmark } from './wordmark'

/**
 * Preloader. Hidden outright without JavaScript - nothing would ever lift it -
 * and the intro timeline in <SiteEffects> counts it up, then slides it away.
 */
export function Loader() {
    return (
        <div
            id="loader"
            aria-hidden="true"
            className="fixed inset-0 z-[100] hidden flex-col items-center justify-center gap-[26px] bg-[#060607] [html.js_&]:flex"
        >
            <div className="opacity-[.72]">
                <Wordmark className="block h-[15px] w-auto text-ink-55" />
            </div>
            {/* Instrument Serif ships no tabular figures (its only GSUB features
                are ccmp/liga/locl), so font-feature-settings:'tnum' was a no-op
                and the digits run 0.249em ('1') to 0.460em ('0') - an 85%
                spread that slid the whole centred block every frame. One fixed
                cell per digit instead: 1ch is the advance of '0', i.e. the
                widest digit, so nothing overflows and the width never changes. */}
            <div className="font-serif text-[clamp(64px,10vw,120px)] leading-none text-ink">
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
