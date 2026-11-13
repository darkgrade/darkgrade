import { Dust } from '@/app/components/dust/dust'
import { Lockup, WordmarkSprite } from '@/app/components/wordmark'

/** The short link's sheet number, in the same series as darkgrade.com's pages. */
const DOCUMENT_NUMBER = 'DG-DK-001'

/** The small capitals of a slate, as darkgrade.com sets them. */
const SLATE = 'font-mono text-[11px] leading-[22px] tracking-[.18em] uppercase'

/** Where the short link sends you: the label, and where it lands. */
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

            <Dust />

            <main className="relative z-[2] flex min-h-dvh flex-col">
                {/* The slate line every sheet on darkgrade.com opens with: it runs the width of the page. */}
                <div
                    className={`mx-auto flex w-[min(1560px,calc(100%-clamp(24px,6vw,128px)))] items-center justify-between gap-4 border-t border-hair pt-[10px] ${SLATE}`}
                >
                    <span className="text-gold">drkgrd.co</span>
                    <span className="text-ink-52">{DOCUMENT_NUMBER}</span>
                </div>

                <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center px-5 pt-[clamp(24px,5vh,48px)] pb-[clamp(32px,6vh,64px)]">
                    <header className="flex flex-col items-center text-center">
                        <a href="https://darkgrade.com" aria-label="Darkgrade" className="block text-ink">
                            <Lockup className="mark-glow text-[21px]" />
                        </a>

                        <h1 className="mt-7 font-serif text-[clamp(2rem,8vw,2.75rem)] leading-[.96] heading-weight tracking-[-.045em]">
                            Shoot more. Edit <span className="glow-hot italic">less.</span>
                        </h1>
                    </header>

                    <nav className="mt-[clamp(32px,6vh,56px)]">
                        <ul className="border-t border-hair">
                            {LINKS.map(link => (
                                <li key={link.label}>
                                    <a
                                        href={link.href}
                                        target="_blank"
                                        rel="noopener"
                                        className="group flex items-baseline justify-between gap-5 border-b border-hair py-[15px] text-[1.0625rem] transition-colors duration-300 hover:text-gold"
                                    >
                                        <span>{link.label}</span>
                                        <span className="font-mono text-[11px] tracking-[.18em] text-ink-52 uppercase transition-colors duration-300 group-hover:text-gold">
                                            {link.detail}
                                        </span>
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>

                {/* darkgrade.com's bottom strip: the blurred panel, edge to edge */}
                <footer className="panel border-t border-hair">
                    <div className="mx-auto flex w-[min(1560px,calc(100%-clamp(24px,6vw,128px)))] items-center justify-between gap-5 py-[20px] font-mono text-[11px] tracking-[.06em] whitespace-nowrap text-ink-52">
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
