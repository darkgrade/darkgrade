import { FeatureList, LINK, MATRIX, type Product, STUDIO, TEST_BENCH } from './products'
import { MARK_NEXT, MARK_ON } from './site-links'

function ProductBox({ product, className = '' }: { product: Product; className?: string }) {
    /* the gold tint is a background image so it layers over the panel's frosted colour instead of replacing it */
    const outline = product.lit
        ? 'border-gold/45 bg-[image:linear-gradient(rgba(246,221,168,.025),rgba(246,221,168,.025))]'
        : 'border-hair'
    return (
        <section className={`panel rounded-[18px] border p-[clamp(18px,2vw,28px)] ${outline} ${className}`}>
            <h3 className="pb-[clamp(14px,1.6vw,20px)]">
                <span
                    className={`block font-serif text-[clamp(1.75rem,2.8vw,2.5rem)] leading-[1.05] font-normal tracking-[-.01em] ${product.lit ? 'text-gold' : 'text-ink'}`}
                >
                    {product.name}
                </span>
                <span className="mt-[10px] block text-label tracking-label text-ink-66 uppercase">{product.kind}</span>
            </h3>
            <FeatureList features={product.features} />
        </section>
    )
}

function headAnimation(up: boolean, twoWay: boolean) {
    if (!twoWay) return 'animate-tip-end'
    return up ? 'animate-tip-both-start' : 'animate-tip-both-end'
}

/** A plain triangle in the line's colour. It lights up as the line's gold band reaches it, so pass the line's timing. */
function Arrowhead({ up = false, twoWay, delaySeconds }: { up?: boolean; twoWay: boolean; delaySeconds: number }) {
    return (
        <svg
            width="12"
            height="9"
            viewBox="0 0 12 9"
            className={`shrink-0 fill-ink/40 ${headAnimation(up, twoWay)} ${up ? 'rotate-180' : ''}`}
            style={{ animationDelay: `${delaySeconds}s` }}
        >
            <path d="M0 0h12L6 9z" />
        </svg>
    )
}

/** An arrow between two layers, with its label to the right of the line. Stretches to fill a flex column. */
function Connector({
    lines,
    twoWay = false,
    delaySeconds = 0,
    className = '',
}: {
    lines: string[]
    twoWay?: boolean
    delaySeconds?: number
    className?: string
}) {
    return (
        <div
            aria-hidden="true"
            className={`flex min-h-[128px] flex-col items-center py-[16px] max-[1000px]:items-start max-[1000px]:pl-[clamp(20px,8vw,48px)] ${className}`}
        >
            {twoWay && <Arrowhead up twoWay delaySeconds={delaySeconds} />}
            <span className="relative flex w-[12px] flex-1 justify-center">
                <span
                    className={`w-[2px] rounded-full bg-[linear-gradient(to_bottom,rgba(234,230,220,.4)_42%,var(--color-gold)_50%,rgba(234,230,220,.4)_58%)] bg-size-[100%_300%] bg-bottom ${twoWay ? 'animate-flow-both' : 'animate-flow'}`}
                    style={{ animationDelay: `${delaySeconds}s` }}
                />
                {/* the label hangs off the line so the line itself stays centred under its box */}
                <span className="absolute top-1/2 left-[25px] -translate-y-1/2 text-label leading-[1.5] tracking-meta whitespace-nowrap text-ink-66 uppercase">
                    {lines.map(line => (
                        <span key={line} className="block">
                            {line}
                        </span>
                    ))}
                </span>
            </span>
            <Arrowhead twoWay={twoWay} delaySeconds={delaySeconds} />
        </div>
    )
}

const CENTRED = 'col-span-2 col-start-2 max-[1000px]:col-span-1 max-[1000px]:col-start-auto'

/** The roadmap as a map of the four products: the apps on top, Link beneath them, Matrix at the base. */
export function ProductMap() {
    return (
        <figure className="font-sans" data-fade>
            <figcaption className="mb-[clamp(24px,3.4vh,36px)]">
                <span className="flex flex-wrap gap-7 text-label tracking-meta text-ink-66 uppercase">
                    <span className="inline-flex items-center gap-[11px]">
                        <i className={MARK_ON} />
                        Here today
                    </span>
                    <span className="inline-flex items-center gap-[11px]">
                        <i className={MARK_NEXT} />
                        On the way
                    </span>
                </span>
            </figcaption>

            {/* four equal columns: every box spans two, so all four are the same width, capped just wide enough
                for the longest bullet to stay on one line. Link and Matrix sit centred under the top pair, and each
                top arrow drops from the column that overlaps Link */}
            <div className="mx-auto grid max-w-[1020px] grid-cols-4 gap-x-[clamp(20px,2.4vw,32px)] max-[1000px]:grid-cols-1">
                <ProductBox product={STUDIO} className="col-span-2 max-[1000px]:col-span-1" />
                <ProductBox
                    product={TEST_BENCH}
                    className="col-span-2 max-[1000px]:col-span-1 max-[1000px]:mt-[24px]"
                />
                <Connector lines={['Runs on Link']} delaySeconds={0.3} className="col-start-2 max-[1000px]:hidden" />
                <Connector lines={['Every fix', 'lands in Link']} className="col-start-3 max-[1000px]:hidden" />
                {/* stacked, a single arrow under both boxes so Studio never appears to sit on the bench */}
                <Connector
                    lines={['Studio runs on Link', 'Fixes from the bench', 'land in Link']}
                    className="hidden max-[1000px]:flex"
                />
                <ProductBox product={LINK} className={CENTRED} />
                <Connector
                    lines={['Share what works', 'on each camera']}
                    twoWay
                    delaySeconds={0.6}
                    className={CENTRED}
                />
                <ProductBox product={MATRIX} className={CENTRED} />
            </div>

            <p className="sr-only">
                Studio is built on Link. Every fix found on the test bench lands in Link, so Studio gets it too. Link
                and Matrix share what works on each camera with each other.
            </p>
        </figure>
    )
}
