import { SceneCanvas } from '@/app/components/scene-canvas'
import type { SceneName } from '@/app/components/scenes/run-scene'

import { Drawing } from './drawing'
import type { MotionName } from './drawing-motion'
import { FeatureList, LINK, type Product, STUDIO } from './products'
import { LABEL, NPM_INSTALL } from './site-links'

/** What stands beside an act's text: a scene rendered live from a 3D model, or an SVG drawing posed by scrolling. */
type Picture = { alt: string; width: number; height: number } & ({ scene: SceneName } | { src: string; motion: MotionName })

type Act = {
    number: string
    product: Product
    picture: Picture
    install?: boolean
}

/** Tall drawings are capped by height, so the studio set never towers over its text. */
const DRAWING_MAX_HEIGHT = 440

const ACTS: Act[] = [
    {
        number: 'Act I',
        product: LINK,
        picture: {
            scene: 'link',
            alt: 'A camera lying lens-up whose lens lifts off its mount and turns as its glass draws apart',
            width: 560,
            height: 430,
        },
        install: true,
    },
    {
        number: 'Act II',
        product: STUDIO,
        picture: {
            scene: 'studio',
            alt: 'A studio being set up around a stage: softbox, lamps, a spotlight and a director’s chair all turn to follow a mark crossing it',
            width: 800,
            height: 600,
        },
    },
    // Matrix is off the home page for now. Its drawing is still in public/products and its motion in drawing-motion.ts.
    // {
    //     number: 'Act III',
    //     product: MATRIX,
    //     picture: {
    //         src: '/products/matrix.svg',
    //         alt: 'A camera record rising from a card index',
    //         width: 600,
    //         height: 430,
    //         motion: 'record',
    //     },
    // },
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

/** The products a creator touches, told in order, with the same bullets as the roadmap. */
export function Acts() {
    return (
        // overflow-x-clip: the live scenes draw past their frames, which on a phone would otherwise widen the page
        <section id="product" className="overflow-x-clip pb-[clamp(100px,14vh,180px)]">
            <div className="shell">
                <div className="mb-[26px] flex items-baseline justify-between">
                    <span className={`${LABEL} text-ink-55`} data-fade>
                        <span className="mr-[14px] text-gold">01</span>Our product, in two acts
                    </span>
                    <span className={`${LABEL} text-ink-52`} data-fade>
                        2026 —
                    </span>
                </div>

                {ACTS.map(({ number, product, picture, install }, index) => (
                    <article
                        key={number}
                        id={product.name.toLowerCase()}
                        data-fade
                        className="grid grid-cols-2 items-center gap-[clamp(40px,6vw,96px)] py-[clamp(48px,8vh,96px)] max-[900px]:grid-cols-1"
                    >
                        {/* drawings alternate sides so the section reads as a sequence, not a list */}
                        <div
                            className={`mx-auto w-full ${index % 2 ? 'order-2 max-[900px]:order-none' : ''}`}
                            style={{ maxWidth: `${(DRAWING_MAX_HEIGHT * picture.width) / picture.height}px` }}
                        >
                            {'scene' in picture ? (
                                <SceneCanvas scene={picture.scene} label={picture.alt} width={picture.width} height={picture.height} />
                            ) : (
                                <Drawing
                                    src={picture.src}
                                    label={picture.alt}
                                    width={picture.width}
                                    height={picture.height}
                                    motion={picture.motion}
                                />
                            )}
                        </div>

                        {/* relative: the text stays above a scene that spills out of its frame */}
                        <div className="relative">
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
