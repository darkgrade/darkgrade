import { LINKS } from './site-links'
import { Wordmark } from './wordmark'

const COL_HEAD = 'mb-5 text-[10.5px] tracking-[.3em] text-ink-35 uppercase'
const COL_LINK =
    'mb-3 block text-[14.5px] text-ink-55 transition-[color,transform] duration-300 ease-lamp hover:translate-x-[6px] hover:text-gold'

const COLUMNS = [
    {
        head: 'Product',
        links: [
            { label: 'Link', href: '#product' },
            { label: 'Studio', href: '#product' },
            { label: 'Roadmap', href: '#roadmap' },
            { label: 'Docs', href: LINKS.docs, external: true },
        ],
    },
    {
        head: 'Community',
        links: [
            { label: 'GitHub', href: LINKS.github, external: true },
            { label: 'Discord', href: LINKS.discord, external: true },
            { label: 'YouTube', href: LINKS.youtube, external: true },
        ],
    },
    {
        head: 'Company',
        links: [
            { label: 'Careers', href: LINKS.careers, external: true },
            { label: 'Contact', href: '#' },
            { label: 'Privacy', href: '#' },
        ],
    },
]

export function SiteFooter() {
    return (
        <footer className="relative overflow-hidden pt-[clamp(180px,26vh,340px)]">
            <div className="shell">
                <div className="flex flex-wrap justify-between gap-10 pb-10 max-[700px]:flex-col max-[700px]:gap-[38px]">
                    <div
                        className="max-w-[30ch] text-[14.5px] leading-[1.7] text-ink-55 max-[700px]:max-w-none"
                        data-fade
                    >
                        <span className="mb-[18px] block">
                            <Wordmark className="mark-glow-soft block h-[19px] w-auto text-ink" />
                        </span>
                        Local-first AI for creative professionals.
                    </div>

                    {COLUMNS.map(col => (
                        <div key={col.head} data-fade>
                            <div className={COL_HEAD}>{col.head}</div>
                            {col.links.map(l => (
                                <a
                                    key={l.label}
                                    href={l.href}
                                    className={COL_LINK}
                                    {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
                                >
                                    {l.label}
                                </a>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            <div className="shell flex flex-wrap justify-between gap-5 border-t border-hair py-[26px] font-mono text-[12px] tracking-[.06em] text-ink-35 max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-[10px]">
                <span>© 2026 DARKGRADE</span>
                <span className="inline-flex items-center gap-2">
                    <i className="size-[7px] animate-blink rounded-full bg-rec shadow-[0_0_10px_rgba(224,72,62,.6)]" />
                    CURRENTLY IN ALPHA
                </span>
                <span>EDITION MMXXVI</span>
            </div>
        </footer>
    )
}
