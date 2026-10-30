import { Drawing } from './drawing'
import type { MotionName } from './drawing-motion'
import { FeatureList, LINK, MATRIX, type Product, STUDIO } from './products'
import { LABEL, NPM_INSTALL } from './site-links'

type Act = {
    number: string
    product: Product
    drawing: { src: string; alt: string; width: number; height: number; motion: MotionName }
    install?: boolean
}

/** Tall drawings are capped by height, so the studio set never towers over its text. */
const DRAWING_MAX_HEIGHT = 440

const ACTS: Act[] = [
    {
        number: 'Act I',
        product: LINK,
        drawing: {
            src: '/products/link.svg',
            alt: 'A camera whose lens lifts as its aperture stops down',
            width: 560,
            height: 430,
            motion: 'aperture',
        },
        install: true,
    },
    {
        number: 'Act II',
        product: STUDIO,
        drawing: {
            src: '/products/studio.svg',
            alt: 'A film studio: a camera on dolly rails faces a stool and backdrop, surrounded by lights and a monitor',
            width: 850,
            height: 750,
            motion: 'studio',
        },
    },
    {
        number: 'Act III',
        product: MATRIX,
        drawing: {
            src: '/products/matrix.svg',
            alt: 'A camera record rising from a card index',
            width: 600,
            height: 430,
            motion: 'record',
        },
    },
]

function InstallLine() {
    return (
        // `npmline` is a cursor-hover hook; [data-copy] is the clipboard hook
        <button
            type="button"
            data-copy={NPM_INSTALL}
            className="npmline group/npm mt-6 inline-flex cursor-pointer items-center gap-[14px] panel rounded-[10px] border border-hair px-[18px] py-3 font-mono text-label text-ink-55 transition-[border-color,box-shadow] duration-[350ms] hover:border-gold hover:shadow-[0_0_26px_rgba(244,198,110,.1)]"
        >
            <span aria-hidden="true" className="text-gold">
                $
            </span>
            <span>{NPM_INSTALL}</span>
            <span className="copy text-label tracking-meta text-ink-52 uppercase transition-colors duration-300 group-hover/npm:text-gold">
                Copy
            </span>
            {/* rendered empty so screen readers pick up the result when it is written */}
            <span role="status" className="copy-status sr-only" />
        </button>
    )
}

/** The three products a creator touches, told in order, with the same bullets as the roadmap. */
export function Acts() {
    return (
        <section id="product" className="pb-[clamp(100px,14vh,180px)]">
            <div className="shell">
                <div className="mb-[26px] flex items-baseline justify-between">
                    <span className={`${LABEL} text-ink-55`} data-fade>
                        <span className="mr-[14px] text-gold">01</span>Our product, in three acts
                    </span>
                    <span className={`${LABEL} text-ink-52`} data-fade>
                        2026 —
                    </span>
                </div>

                {ACTS.map(({ number, product, drawing, install }, index) => (
                    <article
                        key={number}
                        id={product.name.toLowerCase()}
                        data-fade
                        className="grid grid-cols-2 items-center gap-[clamp(40px,6vw,96px)] py-[clamp(48px,8vh,96px)] max-[900px]:grid-cols-1"
                    >
                        {/* drawings alternate sides so the section reads as a sequence, not a list */}
                        <div
                            className={`mx-auto w-full ${index % 2 ? 'order-2 max-[900px]:order-none' : ''}`}
                            style={{ maxWidth: `${(DRAWING_MAX_HEIGHT * drawing.width) / drawing.height}px` }}
                        >
                            <Drawing
                                src={drawing.src}
                                label={drawing.alt}
                                width={drawing.width}
                                height={drawing.height}
                                motion={drawing.motion}
                            />
                        </div>

                        <div>
                            <span className="font-serif text-[1.125rem] text-ink-55 italic">{number}</span>
                            <h2
                                className={`mt-[10px] font-serif text-[clamp(2.25rem,4vw,3.75rem)] leading-none font-normal tracking-[-.01em] ${product.lit ? 'text-gold' : 'text-ink'}`}
                            >
                                {product.name}
                            </h2>
                            <p className="mt-[14px] mb-[clamp(16px,2vw,24px)] text-label tracking-label text-ink-66 uppercase">
                                {product.kind}
                            </p>
                            <FeatureList features={product.features} />
                            {install && <InstallLine />}
                        </div>
                    </article>
                ))}
            </div>
        </section>
    )
}
