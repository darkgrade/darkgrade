import { ProductMap } from './product-map'
import { LABEL } from './site-links'

export function Roadmap() {
    return (
        <section id="roadmap" className="pt-[clamp(110px,15vh,190px)] pb-[clamp(90px,12vh,150px)]">
            <div className="shell">
                <div className="mb-[clamp(30px,4vh,44px)] flex flex-wrap items-start justify-between gap-[18px]">
                    <div>
                        <h1
                            className="max-w-[15ch] font-serif text-[clamp(2.5rem,5vw,4.5rem)] leading-[1.06] font-normal tracking-[-.01em]"
                            data-reveal-lines
                        >
                            From “let’s shoot” to <em className="glow-hot italic">“it’s live.”</em>
                        </h1>
                        <p className="mt-[18px] max-w-[46ch] text-body text-ink-55" data-fade>
                            Link and Studio are here today. We’re building a lot more.
                        </p>
                    </div>
                    <span className={`${LABEL} text-ink-55`} data-fade>
                        The road ahead
                    </span>
                </div>

                <ProductMap />
            </div>
        </section>
    )
}
