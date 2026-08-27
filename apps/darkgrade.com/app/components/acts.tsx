import { CHIP, FILAMENT, LABEL, NPM_INSTALL } from './site-links'

/* the sweep of gold that washes across a row on hover */
const ROW_WASH =
    "before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-500 before:content-[''] hover:before:opacity-100"

function Arrow() {
    return (
        <div className="grid size-[58px] place-items-center rounded-full border border-hair transition-[background,border-color,transform,box-shadow] duration-[450ms] ease-lamp group-hover/act:rotate-45 group-hover/act:border-gold group-hover/act:bg-gold group-hover/act:shadow-[0_0_34px_rgba(244,198,110,.3)] max-[900px]:hidden">
            <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.5"
                className="stroke-ink transition-transform duration-[450ms] ease-lamp group-hover/act:stroke-obsidian"
            >
                <path d="M7 17L17 7M9 7h8v8" />
            </svg>
        </div>
    )
}

const ACTS = [
    {
        num: 'Act I',
        title: 'Link',
        chip: 'shipping' as const,
        body: 'The open-source engine that lets any app speak fluent camera — settings, capture, live view, events. Free, today.',
        install: true,
    },
    {
        num: 'Act II',
        title: 'Studio',
        chip: 'In development' as const,
        body: 'The app that sets the scene, rolls the take, and hands you an automatic first edit the moment you stop recording.',
    },
    {
        num: 'Act III',
        title: 'Create',
        chip: 'The dream' as const,
        body: 'Say what you want to make; get a finished video back. Your footage, your face, your voice — you stay the director.',
    },
]

export function Acts() {
    return (
        <section id="product" className="pb-[clamp(100px,14vh,180px)]">
            <div className="shell">
                <div className="mb-[26px] flex items-baseline justify-between">
                    <span className={`${LABEL} text-ink-55`} data-fade>
                        <span className="mr-[14px] text-gold">01</span>Our product, in three acts
                    </span>
                    <span className={`${LABEL} text-ink-35`} data-fade>
                        2026 —
                    </span>
                </div>

                {ACTS.map(act => (
                    <article
                        key={act.num}
                        data-fade
                        // `act` is a cursor-hover hook for <SiteEffects>
                        className={`act group/act relative grid cursor-pointer grid-cols-[110px_1fr_auto] items-center gap-8 border-t border-hair px-[clamp(8px,1.5vw,28px)] py-[clamp(34px,5vh,54px)] transition-[background] duration-500 last-of-type:border-b before:bg-[image:linear-gradient(90deg,var(--color-gold-dim),transparent_60%)] ${ROW_WASH} max-[900px]:grid-cols-1 max-[900px]:gap-4`}
                    >
                        <div className="font-serif text-[22px] text-ink-35 italic transition-[color,text-shadow] duration-[400ms] group-hover/act:text-gold group-hover/act:[text-shadow:0_0_16px_rgba(244,198,110,.5)] max-[900px]:text-[16px]">
                            {act.num}
                        </div>

                        <div>
                            <h3 className="flex flex-wrap items-center gap-[22px] font-serif text-[clamp(40px,5vw,72px)] leading-none font-normal tracking-[-.01em]">
                                {act.title}{' '}
                                {act.chip === 'shipping' ? (
                                    <span
                                        className={`${CHIP} border border-[rgba(244,198,110,.45)] bg-gold-dim text-gold shadow-[0_0_calc(22px*var(--gI))_rgba(244,198,110,.13)]`}
                                    >
                                        <span className={FILAMENT} />
                                        Shipping now
                                    </span>
                                ) : (
                                    <span className={`${CHIP} border border-hair text-ink-55`}>
                                        <span className="size-[7px] shrink-0 rounded-full border border-ink-35" />
                                        {act.chip}
                                    </span>
                                )}
                            </h3>

                            <p className="mt-[14px] max-w-[52ch] text-[15.5px] text-ink-55">{act.body}</p>

                            {act.install && (
                                // `npmline` is a cursor-hover hook; [data-copy] is the clipboard hook
                                <span
                                    data-copy={NPM_INSTALL}
                                    className="npmline group/npm mt-5 inline-flex cursor-pointer items-center gap-[14px] rounded-[10px] border border-hair px-[18px] py-3 font-mono text-[13px] text-ink-55 transition-[border-color,box-shadow] duration-[350ms] hover:border-[rgba(244,198,110,.4)] hover:shadow-[0_0_26px_rgba(244,198,110,.1)]"
                                >
                                    <span className="text-gold">$</span>
                                    <span>{NPM_INSTALL}</span>
                                    <span className="copy text-[11px] tracking-[.1em] text-ink-35 transition-colors duration-300 group-hover/npm:text-gold">
                                        COPY
                                    </span>
                                </span>
                            )}
                        </div>

                        <Arrow />
                    </article>
                ))}
            </div>
        </section>
    )
}
