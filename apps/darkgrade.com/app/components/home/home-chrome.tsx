import Link from 'next/link'

import { EXPERIMENTS, LINKS } from '@/app/components/home/content'
import { Lockup } from '@/app/components/wordmark'

const TEXT = {
    strong: 'text-[#eae6dc]',
    soft: 'text-[#eae6dc]/55',
    hover: 'hover:text-gold',
    rule: 'border-[#eae6dc]/15',
} as const

const NAV = [
    { label: 'Product', href: '#product' },
    { label: 'Principles', href: '#principles' },
    { label: 'Docs', href: LINKS.docs },
    { label: 'Experiments', href: '/toolbench/' },
]

/** The home page's header: the wordmark, the four links, GitHub. Fixed to the top of the window, and half as tall on a phone or an upright tablet, where the picture sits right under it. */
export function HomeHeader({ className = '' }: { className?: string }) {
    const text = TEXT
    const link = `text-[14px] transition-colors duration-300 ${text.soft} ${text.hover}`
    return (
        <header className={`pointer-events-none fixed inset-x-0 top-0 z-[80] ${className}`}>
            {/* the page fades out under the header, so words scrolling up never run into it */}
            <div
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-[#0a0a0b] via-[#0a0a0b]/80 to-transparent max-[900px]:h-[60px]`}
            />
            <div className="shell relative flex h-[76px] items-center justify-between max-[900px]:h-[38px]">
                <Link href="#top" aria-label="Darkgrade" className={`pointer-events-auto block ${text.strong}`}>
                    <Lockup className="text-[21px] max-[900px]:text-[18px]" />
                </Link>
                <nav className="pointer-events-auto flex items-center gap-[32px] max-[900px]:hidden">
                    {NAV.map(item => (
                        <a key={item.label} href={item.href} className={link}>
                            {item.label}
                        </a>
                    ))}
                </nav>
                <a href={LINKS.github} target="_blank" rel="noopener" className={`pointer-events-auto ${link}`}>
                    GitHub
                </a>
            </div>
        </header>
    )
}

const COLUMNS = [
    {
        head: 'Product',
        links: [
            { label: 'Link', href: '#link' },
            { label: 'Studio', href: '#studio' },
            { label: 'Docs', href: LINKS.docs },
        ],
    },
    { head: 'Experiments', links: EXPERIMENTS.map(experiment => ({ label: experiment.name, href: experiment.href })) },
    {
        head: 'Community',
        links: [
            { label: 'GitHub', href: LINKS.github },
            { label: 'Discord', href: LINKS.discord },
            { label: 'YouTube', href: LINKS.youtube },
        ],
    },
    { head: 'Company', links: [{ label: 'Careers', href: LINKS.careers }] },
]

/** The home page's footer. */
export function HomeFooter({ className = '' }: { className?: string }) {
    const text = TEXT
    return (
        <footer className={`relative border-t ${text.rule} ${className}`}>
            <div className="shell flex flex-wrap justify-between gap-10 py-[clamp(48px,8vh,72px)] max-[700px]:flex-col">
                <div className={`max-w-[30ch] text-[14px] leading-[1.7] ${text.soft}`}>
                    <div className="mb-[18px]">
                        <Lockup className={`text-[25px] ${text.strong}`} />
                    </div>
                    Local-first AI for creative professionals.
                </div>
                {COLUMNS.map(column => (
                    <div key={column.head}>
                        <div className={`mb-5 text-[13px] tracking-[.3em] uppercase ${text.soft}`}>{column.head}</div>
                        {column.links.map(item => (
                            <a
                                key={item.label}
                                href={item.href}
                                className={`mb-3 block text-[14px] transition-colors duration-300 ${text.soft} ${text.hover}`}
                            >
                                {item.label}
                            </a>
                        ))}
                    </div>
                ))}
            </div>
            <div
                className={`shell flex flex-wrap justify-between gap-5 border-t ${text.rule} py-[26px] font-mono text-[13px] tracking-[.06em] ${text.soft}`}
            >
                <span>© 2026 DARKGRADE</span>
                <span className="inline-flex items-center gap-2">
                    <i className="size-[7px] rounded-full bg-[#e0483e] shadow-[0_0_10px_rgba(224,72,62,.6)]" />
                    CURRENTLY IN ALPHA
                </span>
                <span>EDITION MMXXVI</span>
            </div>
        </footer>
    )
}
