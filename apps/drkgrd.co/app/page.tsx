import { BackgroundVideo } from '@/app/components/background-video'
import { Lockup, WordmarkSprite } from '@/app/components/wordmark'

/** The short link's sheet number, in the same series as darkgrade.com's pages. */
const DOCUMENT_NUMBER = 'DG-DK-001'

/** The small capitals of a slate, as darkgrade.com sets them. */
const SLATE = 'font-mono text-[11px] leading-[22px] tracking-[.18em] uppercase'

const FACTS = [
    { name: 'What this is', value: 'The short link' },
    { name: 'Goes to', value: 'darkgrade.com' },
    { name: 'Built in', value: 'Denver, Colorado' },
    { name: 'Status', value: 'In alpha' },
]

/** Where the short link sends you, as ruled rows rather than a stack of buttons. */
const LINKS = [
    { label: 'The site', detail: 'darkgrade.com', href: 'https://darkgrade.com' },
    { label: 'Watch it in action', detail: 'YouTube', href: 'https://www.youtube.com/watch?v=tsNWxj-pmU4' },
    { label: 'Read the code', detail: 'GitHub', href: 'https://github.com/darkgrade/darkgrade' },
    { label: 'Talk to us', detail: 'Discord', href: 'https://discord.gg/fbDbdJv9dX' },
    { label: 'Read the docs', detail: 'darkgrade.com/docs', href: 'https://darkgrade.com/docs/link' },
]

export default function Home() {
    return (
        <>
            <WordmarkSprite />
            <BackgroundVideo />

            <main className="relative z-[2] flex min-h-dvh flex-col">
                <div className="shell flex flex-1 flex-col pt-[clamp(28px,5vh,56px)] pb-[clamp(40px,7vh,80px)]">
                    <header className="flex items-center justify-between gap-5">
                        <a href="https://darkgrade.com" aria-label="Darkgrade" className="block text-ink">
                            <Lockup className="mark-glow text-[21px] max-[900px]:text-[18px]" />
                        </a>
                        <a
                            href="https://darkgrade.com"
                            className={`${SLATE} text-ink-55 transition-colors duration-300 hover:text-gold max-[700px]:hidden`}
                        >
                            darkgrade.com
                        </a>
                    </header>

                    {/* The slate line every sheet on darkgrade.com opens with. */}
                    <div
                        className={`mt-[clamp(28px,5vh,56px)] flex items-center justify-between gap-4 border-t border-hair pt-[10px] ${SLATE}`}
                    >
                        <span className="flex items-center gap-4">
                            <span className="text-gold">drkgrd.co</span>
                            <span className="text-ink-66 max-[700px]:hidden">The short link</span>
                        </span>
                        <span className="text-ink-52">{DOCUMENT_NUMBER}</span>
                    </div>

                    <section className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-end gap-x-[clamp(32px,6vw,110px)] gap-y-8 pt-[clamp(48px,11vh,130px)] max-[900px]:grid-cols-1">
                        <h1 className="ml-[-.04em] font-serif text-[clamp(2.25rem,5.5vw,6.25rem)] leading-[.96] heading-weight tracking-[-.05em] whitespace-nowrap">
                            <span className="block">Shoot more.</span>
                            <span className="block">
                                Edit <span className="glow-hot italic">less.</span>
                            </span>
                        </h1>
                        <p className="max-w-[46ch] pb-[.6em] text-[clamp(1rem,1.15vw,1.1875rem)] leading-[1.6] text-ink-66">
                            Darkgrade dials in your camera, captures the shot, and returns a finished first cut — on
                            your own machine. You stay the director.
                        </p>
                    </section>

                    <dl className="mt-[clamp(40px,8vh,88px)] grid grid-cols-4 border border-hair font-mono text-[11px] leading-[1.5] tracking-[.18em] uppercase max-[900px]:grid-cols-2">
                        {FACTS.map(fact => (
                            <div
                                key={fact.name}
                                className="flex flex-col gap-[6px] border-l border-hair px-[18px] py-[13px] first:border-l-0 max-[900px]:[&:nth-child(3)]:border-l-0 max-[900px]:[&:nth-child(n+3)]:border-t"
                            >
                                <dt className="text-ink-52">{fact.name}</dt>
                                <dd className="text-ink">{fact.value}</dd>
                            </div>
                        ))}
                    </dl>

                    <section className="mt-[clamp(40px,8vh,88px)]">
                        <h2 className={`${SLATE} border-t border-hair pt-[10px] text-ink-66`}>
                            <span className="mr-4 text-gold">Where to</span>
                            Everything Darkgrade, from here
                        </h2>
                        <ul className="mt-2">
                            {LINKS.map(link => (
                                <li key={link.label}>
                                    <a
                                        href={link.href}
                                        target="_blank"
                                        rel="noopener"
                                        className="group flex items-baseline justify-between gap-5 border-b border-hair py-[15px] text-[clamp(1rem,1.15vw,1.1875rem)] transition-colors duration-300 hover:text-gold"
                                    >
                                        <span>{link.label}</span>
                                        <span className="font-mono text-[11px] tracking-[.18em] text-ink-52 uppercase transition-colors duration-300 group-hover:text-gold">
                                            {link.detail}
                                        </span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>

                {/* darkgrade.com's bottom strip: the blurred panel, edge to edge */}
                <footer className="panel border-t border-hair">
                    <div className="shell flex items-center justify-between gap-5 py-[22px] font-mono text-xs tracking-[.06em] whitespace-nowrap text-ink-52">
                        <span>© 2026 DARKGRADE</span>
                        <span className="inline-flex items-center gap-2">
                            <i className="size-[6px] animate-blink rounded-full bg-rec shadow-[0_0_10px_rgba(224,72,62,.6)]" />
                            CURRENTLY IN ALPHA
                        </span>
                        <span className="max-[640px]:hidden">EDITION MMXXVI</span>
                    </div>
                </footer>
            </main>
        </>
    )
}
