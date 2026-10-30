import { MARK_NEXT, MARK_ON } from './site-links'

type Feature = { text: string; on?: boolean }

type Product = { name: string; kind: string; features: Feature[]; columns: string; lit?: boolean }

const today = (text: string): Feature => ({ text, on: true })
const next = (text: string): Feature => ({ text })

const TWO_COLUMNS = 'grid grid-cols-2 max-[720px]:grid-cols-1'
/* short bullets sit side by side at their natural width instead of stretching across a wide box */
const IN_A_ROW = 'flex flex-wrap'

const STUDIO: Product = {
    name: 'Studio',
    kind: 'No-code desktop & mobile app',
    columns: TWO_COLUMNS,
    features: [
        today('Set up your lights and camera in one tap'),
        today('Works with the gear you already own'),
        next('Voice control for your whole studio'),
        next('A first cut ready when you stop recording'),
    ],
}

const TEST_BENCH: Product = {
    name: 'Test bench',
    kind: 'Our in-house camera lab',
    columns: '',
    features: [today('Every release tested on real cameras'), today('Recover and debug cameras with MCP')],
}

const LINK: Product = {
    name: 'Link',
    kind: 'Open-source library',
    columns: IN_A_ROW,
    lit: true,
    features: [
        today('Control your camera from any app'),
        today('Works with Sony / Nikon / Canon'),
        next('More camera brands'),
        next('Let local models control your camera with MCP'),
    ],
}

const MATRIX: Product = {
    name: 'Matrix',
    kind: 'Camera compatibility list',
    columns: IN_A_ROW,
    features: [
        today('See what works with your camera'),
        today('See why we know it works with your camera'),
        next('Share what you know about your camera'),
    ],
}

function FeatureRow({ feature }: { feature: Feature }) {
    return (
        <li className={`flex items-start gap-[12px] py-[6px] text-body-sm ${feature.on ? 'text-ink' : 'text-ink-55'}`}>
            {/* one line tall, so the dot centres on the first line however many lines the text wraps to */}
            <span className="flex h-[1lh] items-center">
                <i className={feature.on ? MARK_ON : MARK_NEXT} />
            </span>
            <span>
                <span className="sr-only">{feature.on ? 'Here today: ' : 'On the way: '}</span>
                {feature.text}
            </span>
        </li>
    )
}

function ProductBox({ product, className = '' }: { product: Product; className?: string }) {
    /* the gold tint is a background image so it layers over the panel's frosted colour instead of replacing it */
    const outline = product.lit
        ? 'border-gold/45 bg-[image:linear-gradient(rgba(246,221,168,.025),rgba(246,221,168,.025))]'
        : 'border-hair'
    return (
        <section className={`panel rounded-[18px] border p-[clamp(18px,2vw,28px)] ${outline} ${className}`}>
            <h3 className="flex flex-wrap items-baseline gap-x-[14px] gap-y-1 pb-[12px] text-label tracking-label uppercase">
                <span className={product.lit ? 'text-gold' : 'text-ink'}>{product.name}</span>
                <span className="text-ink-52">{product.kind}</span>
            </h3>
            <ul className={`gap-x-[clamp(28px,3.4vw,52px)] ${product.columns}`}>
                {product.features.map(feature => (
                    <FeatureRow key={feature.text} feature={feature} />
                ))}
            </ul>
        </section>
    )
}

function Arrowhead({ up = false }: { up?: boolean }) {
    return (
        <svg
            width="11"
            height="6"
            viewBox="0 0 11 6"
            fill="none"
            className={`shrink-0 stroke-ink-55 ${up ? 'rotate-180' : ''}`}
        >
            <path d="M1 .5l4.5 4.5 4.5-4.5" strokeWidth="1" />
        </svg>
    )
}

/** An arrow between two layers, with its label to the right of the line. Stretches to fill a flex column. */
function Connector({
    lines,
    twoWay = false,
    className = '',
}: {
    lines: string[]
    twoWay?: boolean
    className?: string
}) {
    return (
        <div
            aria-hidden="true"
            className={`flex min-h-[64px] flex-col items-center max-[1000px]:items-start max-[1000px]:pl-[clamp(20px,8vw,48px)] ${className}`}
        >
            {twoWay && <Arrowhead up />}
            <span className="relative flex w-[11px] flex-1 justify-center">
                <span className="w-px bg-ink-55" />
                {/* the label hangs off the line so the line itself stays centred under its box */}
                <span className="absolute top-1/2 left-[25px] -translate-y-1/2 text-label leading-[1.5] tracking-meta whitespace-nowrap text-ink-55 uppercase">
                    {lines.map(line => (
                        <span key={line} className="block">
                            {line}
                        </span>
                    ))}
                </span>
            </span>
            <Arrowhead />
        </div>
    )
}

/** The roadmap as a map of the four products: the apps on top, Link beneath them, Matrix at the base. */
export function ProductMap() {
    return (
        <figure className="font-sans" data-fade>
            <figcaption className="mb-[clamp(24px,3.4vh,36px)] flex justify-end">
                <span className="flex flex-wrap gap-7 text-label tracking-meta text-ink-52 uppercase">
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

            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-x-[clamp(14px,1.6vw,20px)] max-[1000px]:grid-cols-1">
                <ProductBox product={STUDIO} />
                {/* the bench's arrow runs the full height of Studio, down to Link */}
                <div className="row-span-2 flex flex-col max-[1000px]:row-span-1">
                    <ProductBox product={TEST_BENCH} className="max-[1000px]:mt-[14px]" />
                    <Connector lines={['Every fix', 'lands in Link']} className="flex-1 max-[1000px]:hidden" />
                </div>
                <Connector lines={['Runs on Link']} className="max-[1000px]:hidden" />
                {/* stacked, a single arrow under both boxes so Studio never appears to sit on the bench */}
                <Connector
                    lines={['Studio runs on Link', 'Fixes from the bench', 'land in Link']}
                    className="hidden max-[1000px]:flex"
                />
                <ProductBox product={LINK} className="col-span-full" />
                <Connector lines={['Share what works', 'on each camera']} twoWay className="col-span-full" />
                <ProductBox product={MATRIX} className="col-span-full" />
            </div>

            <p className="sr-only">
                Studio is built on Link. Every fix found on the test bench lands in Link, so Studio gets it too. Link
                and Matrix share what works on each camera with each other.
            </p>
        </figure>
    )
}
