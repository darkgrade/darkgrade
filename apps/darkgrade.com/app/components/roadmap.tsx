import { ProductMap } from './product-map'

export function Roadmap() {
    return (
        <section id="roadmap" className="pt-[clamp(110px,15vh,190px)] pb-[clamp(90px,12vh,150px)]">
            <div className="shell">
                <div className="mb-[clamp(30px,4vh,44px)]">
                    <span className="text-label tracking-label text-ink-66 uppercase" data-fade>
                        The road ahead
                    </span>
                    <h1
                        className="mt-[18px] mb-[37px] max-w-[15ch] font-serif text-[clamp(2.25rem,4vw,3.75rem)] leading-[1.06] font-normal tracking-[-.01em]"
                        data-reveal-lines
                    >
                        From “let’s shoot” to <em className="glow-hot italic">“it’s live.”</em>
                    </h1>
                </div>

                <ProductMap />
            </div>
        </section>
    )
}
