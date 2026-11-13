import Link from 'next/link'

import { EXPERIMENTS, LINKS } from '@/app/components/home/content'
import { Lockup } from '@/app/components/wordmark'

const TEXT = {
    strong: 'text-[#eae6dc]',
    soft: 'text-[#eae6dc]/55',
    hover: 'hover:text-gold',
    rule: 'border-[#eae6dc]/15',
} as const

/* The sections are written with the home page's path, so the same header and footer work from the About page. */
const NAV = [
    { label: 'Product', href: '/#product' },
    { label: 'Principles', href: '/#principles' },
    { label: 'Docs', href: LINKS.docs },
]

/**
 * The header's Experiments item: a word that opens a list of the benches under it, each with a
 * line on what it is, when it is hovered or focused. The benches are sites of their own served
 * under darkgrade.com, so they are plain links and full page loads.
 */
function ExperimentsMenu({ wordClassName }: { wordClassName: string }) {
    return (
        <div className="group relative flex items-center">
            <button type="button" aria-haspopup="true" className={`${wordClassName} cursor-default`}>
                Experiments
            </button>
            {/* the gap between the word and the list is part of what is hovered, so the pointer can cross it; the fade is on the list itself, since fading a wrapper would switch its blur off until the fade ends */}
            <div className="invisible absolute top-full left-1/2 -translate-x-1/2 pt-[18px] transition-[visibility] duration-300 group-focus-within:visible group-hover:visible">
                <ul className="w-[316px] translate-y-[6px] rounded-[10px] border border-hair bg-[rgba(9,9,10,.86)] px-[18px] py-[5px] opacity-0 shadow-[0_18px_50px_rgba(0,0,0,.55)] backdrop-blur-[18px] transition-[opacity,translate] duration-300 ease-[cubic-bezier(.19,1,.22,1)] group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100">
                    {EXPERIMENTS.map((experiment, index) => (
                        <li key={experiment.name} className="border-t border-hair first:border-t-0">
                            <a href={experiment.href} className="group/row flex items-baseline gap-[14px] py-[13px]">
                                <span className="font-mono text-[10.5px] tracking-[.06em] text-ink-52 transition-colors duration-300 group-hover/row:text-gold group-focus-visible/row:text-gold">
                                    /{String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="flex min-w-0 flex-col gap-[3px]">
                                    <span className="text-[15px] leading-[1.2] font-medium text-ink transition-colors duration-300 group-hover/row:text-gold group-focus-visible/row:text-gold">
                                        {experiment.name}
                                    </span>
                                    <span className="text-[13px] leading-[1.4] text-ink-55">
                                        {experiment.description}
                                    </span>
                                </span>
                            </a>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

interface HomeHeaderProps {
    className?: string
    /** On a page whose words scroll up under the header, it stands on a band of the page's own colour, so they never show through its links. */
    overScrollingWords?: boolean
}

/** The site's header: the wordmark, three links and the Experiments menu, GitHub. Fixed to the top of the window, and half as tall on a phone or an upright tablet, where the picture sits right under it. */
export function HomeHeader({ className = '', overScrollingWords = false }: HomeHeaderProps) {
    const text = TEXT
    const link = `text-[14px] transition-colors duration-300 ${text.soft} ${text.hover}`
    return (
        <header className={`pointer-events-none fixed inset-x-0 top-0 z-[80] ${className}`}>
            {/* the page fades out under the header, so words scrolling up never run into it */}
            <div
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 h-[120px] bg-gradient-to-b from-[#0a0a0b] via-[#0a0a0b]/80 to-transparent max-[900px]:h-[60px]`}
            />
            {overScrollingWords && (
                <div
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-[76px] bg-[#0a0a0b]/90 backdrop-blur-[14px] max-[900px]:h-[38px]"
                />
            )}
            <div className="shell relative flex h-[76px] items-center justify-between max-[900px]:h-[38px]">
                <Link href="/#top" aria-label="Darkgrade" className={`pointer-events-auto block ${text.strong}`}>
                    <Lockup className="text-[21px] max-[900px]:text-[18px]" />
                </Link>
                <nav className="pointer-events-auto flex items-center gap-[32px] max-[900px]:hidden">
                    {NAV.map(item => (
                        <a key={item.label} href={item.href} className={link}>
                            {item.label}
                        </a>
                    ))}
                    <ExperimentsMenu wordClassName={link} />
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
            { label: 'Link', href: '/#link' },
            { label: 'Studio', href: '/#studio' },
            { label: 'Docs', href: LINKS.docs },
            { label: 'Changelog', href: LINKS.changelog },
        ],
    },
    { head: 'Experiments', links: EXPERIMENTS.map(experiment => ({ label: experiment.name, href: experiment.href })) },
    {
        head: 'Community',
        links: [
            { label: 'GitHub', href: LINKS.github },
            { label: 'Discord', href: LINKS.discord },
            { label: 'YouTube', href: LINKS.youtube },
            { label: 'X', href: LINKS.x },
            { label: 'LinkedIn', href: LINKS.linkedin },
        ],
    },
    {
        head: 'Company',
        links: [
            { label: 'About', href: '/about' },
            { label: 'Careers', href: LINKS.careers },
            { label: 'Contact', href: `mailto:${LINKS.contactEmail}` },
            { label: 'Privacy', href: LINKS.privacy },
        ],
    },
]

/** The site's footer. */
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
                <span>© 2026 DARKGRADE, INC.</span>
                <span className="inline-flex items-center gap-2">
                    <i className="size-[7px] rounded-full bg-[#e0483e] shadow-[0_0_10px_rgba(224,72,62,.6)]" />
                    CURRENTLY IN ALPHA
                </span>
                <span>EDITION MMXXVI</span>
            </div>
        </footer>
    )
}
