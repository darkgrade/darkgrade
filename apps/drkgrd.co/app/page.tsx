import { BackgroundVideo } from '@/app/components/background-video'
import { Wordmark, WordmarkSprite } from '@/app/components/wordmark'

const LINKS = [
    { label: 'Visit darkgrade.com', href: 'https://darkgrade.com', primary: true },
    { label: 'Watch it in action', href: 'https://www.youtube.com/watch?v=tsNWxj-pmU4' },
    { label: 'Star on GitHub', href: 'https://github.com/darkgrade/darkgrade' },
    { label: 'Join the Discord', href: 'https://discord.gg/fbDbdJv9dX' },
    { label: 'Read the docs', href: 'https://darkgrade.com/docs/link' },
]

const BUTTON =
    'flex w-full items-center justify-center rounded-full px-8 py-[17px] text-label tracking-[.04em] transition-[background,border-color,color,box-shadow] duration-[350ms] hover:shadow-[0_0_26px_rgba(244,198,110,.16)]'
const BUTTON_SOLID = `${BUTTON} bg-ink text-obsidian hover:bg-gold`
const BUTTON_GHOST = `${BUTTON} panel border border-hair text-ink hover:border-gold hover:text-gold`

export default function Home() {
    return (
        <>
            <WordmarkSprite />
            <BackgroundVideo />

            <main className="relative z-[2] flex min-h-dvh flex-col">
                <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col items-center justify-center px-4 py-[clamp(40px,7vh,80px)]">
                    <header className="flex flex-col items-center text-center">
                        <a href="https://darkgrade.com" aria-label="Darkgrade" className="block text-ink">
                            <Wordmark className="mark-glow block h-[15px] w-auto" />
                        </a>

                        <h1 className="mt-6 font-serif text-[clamp(2rem,8vw,2.75rem)] leading-[.94] font-normal tracking-[-.015em]">
                            Shoot more. Edit <span className="glow-hot tracking-normal italic">less.</span>
                        </h1>

                        <p className="mt-3 text-label tracking-meta text-ink-55 uppercase">
                            Local-first AI
                            <br />
                            for creative pros
                        </p>
                    </header>

                    <nav className="mt-9 flex w-full flex-col gap-[14px]">
                        {LINKS.map(({ label, href, primary }) => (
                            <a
                                key={label}
                                href={href}
                                target="_blank"
                                rel="noopener"
                                className={primary ? BUTTON_SOLID : BUTTON_GHOST}
                            >
                                {label}
                            </a>
                        ))}
                    </nav>
                </div>

                {/* darkgrade.com's bottom strip: the blurred panel, edge to edge */}
                <footer className="panel">
                    <div className="mx-auto flex w-[min(1560px,calc(100%-clamp(40px,6vw,128px)))] items-center justify-between gap-5 py-[22px] font-mono text-xs tracking-[.06em] whitespace-nowrap text-ink-52">
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
