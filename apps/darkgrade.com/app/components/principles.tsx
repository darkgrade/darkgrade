import { LABEL } from './site-links'

const PRINCIPLES = [
    {
        idx: '/01',
        title: 'You’re never replaced',
        body: 'No AI slop, no fake people. We make your real footage move faster — and give you back your evenings.',
    },
    {
        idx: '/02',
        title: 'Local-first & private',
        body: 'Everything runs on your machine by default. We don’t train on your footage.',
    },
    {
        idx: '/03',
        title: 'Open & honest',
        body: 'A fair core that stays free, fair pricing for the app, no bait-and-switch.',
    },
    {
        idx: '/04',
        title: 'Fast as your ideas',
        body: 'Camera manufacturers move in decades. An open product moves at the speed of its community.',
    },
]

export function Principles() {
    return (
        <section id="principles" className="py-[clamp(120px,16vh,200px)]">
            <div className="shell">
                <div className="mb-[clamp(48px,8vh,90px)] flex flex-wrap items-start justify-between gap-3">
                    <h2
                        className="font-serif text-[clamp(40px,5vw,72px)] leading-[1.06] font-normal tracking-[-.01em]"
                        data-reveal-lines
                    >
                        The hills we’ll <em className="glow-hot italic">die on.</em>
                    </h2>
                    <span className={`${LABEL} mt-[14px] text-ink-55`} data-fade>
                        <span className="mr-[14px] text-gold">03</span>Principles
                    </span>
                </div>

                {PRINCIPLES.map(p => (
                    <div
                        key={p.idx}
                        data-fade
                        className="group/p relative grid grid-cols-[minmax(60px,140px)_1fr_1.1fr] items-center gap-[clamp(20px,4vw,64px)] border-t border-hair px-[clamp(8px,1.5vw,26px)] py-[clamp(30px,4.5vh,46px)] transition-[background] duration-500 last:border-b before:pointer-events-none before:absolute before:inset-0 before:bg-[image:linear-gradient(90deg,rgba(244,198,110,.07),transparent_55%)] before:opacity-0 before:transition-opacity before:duration-[550ms] before:content-[''] hover:before:opacity-100 max-[820px]:grid-cols-[48px_1fr]"
                    >
                        <span className="font-serif text-[clamp(20px,2vw,28px)] leading-none tracking-normal text-ink-35 italic transition-[color,text-shadow] duration-[450ms] group-hover/p:text-gold group-hover/p:[text-shadow:0_0_15px_rgba(244,198,110,.45)]">
                            {p.idx}
                        </span>
                        <h3 className="font-serif text-[clamp(26px,2.6vw,40px)] leading-[1.15] font-normal">
                            {p.title}
                        </h3>
                        <p className="max-w-[52ch] text-[15px] text-ink-55 max-[820px]:col-start-2">{p.body}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}
