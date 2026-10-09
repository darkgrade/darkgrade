import Link from 'next/link'

import { LINKS } from './site-links'
import { Wordmark } from './wordmark'

const COL_HEAD = 'mb-5 text-label tracking-label text-ink-52 uppercase'
const COL_LINK =
    'mb-3 block text-body-sm text-ink-55 transition-[color,transform] duration-300 ease-lamp hover:translate-x-[6px] hover:text-gold'

const COLUMNS = [
    {
        head: 'Product',
        links: [
            { label: 'Link', href: '/#link' },
            { label: 'Studio', href: '/#studio' },
            { label: 'Roadmap', href: '/roadmap' },
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
        links: [{ label: 'Careers', href: LINKS.careers, external: true }],
    },
]

export function SiteFooter() {
    return (
        <footer className="relative overflow-hidden pt-[clamp(180px,26vh,340px)]">
            {/* a blurred panel from the left edge to the right edge, like the scrolled header; the content inside keeps the page margins */}
            <div className="panel">
                <div className="shell pt-[clamp(48px,8vh,72px)]">
                    <div className="flex flex-wrap justify-between gap-10 pb-10 max-[700px]:flex-col max-[700px]:gap-[38px]">
                        <div
                            className="max-w-[30ch] text-body-sm leading-[1.7] text-ink-55 max-[700px]:max-w-none"
                            data-fade
                        >
                            <span className="mb-[18px] block">
                                <Wordmark className="mark-glow-soft block h-[19px] w-auto text-ink" />
                            </span>
                            Local-first AI for creative professionals.
                            <p className="mt-[18px] text-ink-52 opacity-60 text-label">
                                Background footage courtesy{' '}
                                <a
                                    href="https://www.pexels.com/@kuiyibo/"
                                    target="_blank"
                                    rel="noopener"
                                    className="underline decoration-ink-52 underline-offset-[3px] transition-colors duration-300 hover:text-gold hover:decoration-gold"
                                >
                                    @kuiyibo
                                </a>{' '}
                                &amp; others on{' '}
                                <a
                                    href="https://www.pexels.com/"
                                    target="_blank"
                                    rel="noopener"
                                    className="underline decoration-ink-52 underline-offset-[3px] transition-colors duration-300 hover:text-gold hover:decoration-gold"
                                >
                                    Pexels
                                </a>
                            </p>
                        </div>

                        {COLUMNS.map(col => (
                            <div key={col.head} data-fade>
                                <div className={COL_HEAD}>{col.head}</div>
                                {/* site pages move client-side, inside the (site) layout */}
                                {col.links.map(l =>
                                    'external' in l && l.external ? (
                                        <a
                                            key={l.label}
                                            href={l.href}
                                            className={COL_LINK}
                                            target="_blank"
                                            rel="noopener"
                                        >
                                            {l.label}
                                        </a>
                                    ) : (
                                        <Link key={l.label} href={l.href} className={COL_LINK}>
                                            {l.label}
                                        </Link>
                                    )
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                <div className="shell flex flex-wrap justify-between gap-5 py-[26px] font-mono text-label tracking-[.06em] text-ink-52 max-[700px]:flex-col max-[700px]:items-start max-[700px]:gap-[10px]">
                    <span>© 2026 DARKGRADE</span>
                    <span className="inline-flex items-center gap-2">
                        <i className="size-[7px] animate-blink rounded-full bg-rec shadow-[0_0_10px_rgba(224,72,62,.6)]" />
                        CURRENTLY IN ALPHA
                    </span>
                    <span>EDITION MMXXVI</span>
                </div>
            </div>
        </footer>
    )
}
