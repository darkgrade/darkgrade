import Link from 'next/link'

import { BackgroundToggle } from './background-toggle'
import { CONTOUR_BACKGROUND_ENABLED } from './backgrounds/field'
import { LINKS } from './site-links'
import { Wordmark } from './wordmark'

/** JS toggles `.scrolled` on the header once the top marker leaves the viewport. */
/* Home-page sections are written "/#id" so the same header works on /roadmap. */
const NAV = [
    { label: 'Product', href: '/#product' },
    { label: 'Roadmap', href: '/roadmap' },
    { label: 'Principles', href: '/#principles' },
    { label: 'Docs', href: LINKS.docs, external: true },
]

/* Separate Vercel apps served under darkgrade.com by the rewrites in vercel.json: full page loads, not Link. */
const EXPERIMENTS = [
    { label: 'Toolbench', description: 'Local models that control a camera', href: '/toolbench/' },
    { label: 'Voicebench', description: 'Speech models on real voices', href: '/voicebench/' },
    { label: 'Cambench', description: 'Camera specs, verified across sources', href: '/cambench/' },
]

const NAV_LINK =
    'relative text-label tracking-[.06em] text-ink-55 transition-[color,text-shadow] duration-300 hover:text-ink hover:[text-shadow:0_0_12px_rgba(244,198,110,.35)] ' +
    "after:absolute after:-bottom-[5px] after:left-0 after:h-px after:w-full after:origin-right after:scale-x-0 after:bg-gold after:shadow-[0_0_9px_rgba(244,198,110,.55)] after:transition-transform after:duration-[450ms] after:ease-lamp after:content-[''] " +
    'hover:after:origin-left hover:after:scale-x-100'

export function SiteHeader() {
    return (
        <header
            id="hdr"
            className="fixed inset-x-0 top-0 z-[80] transition-[background,backdrop-filter] duration-500 [&.scrolled]:panel"
        >
            <div className="shell flex h-[64px] items-center justify-between transition-[height] duration-500 ease-lamp [.scrolled_&]:h-[56px]">
                <Link href="/" aria-label="Darkgrade" className="block text-ink">
                    <Wordmark className="mark-glow block h-[15px] w-auto max-[400px]:h-[13px]" />
                </Link>

                <nav className="flex items-center gap-[32px] max-[900px]:hidden">
                    {/* site pages move client-side, inside the (site) layout */}
                    {NAV.map(({ label, href, external }) =>
                        external ? (
                            <a key={label} href={href} className={NAV_LINK} target="_blank" rel="noopener">
                                {label}
                            </a>
                        ) : (
                            <Link key={label} href={href} className={NAV_LINK}>
                                {label}
                            </Link>
                        )
                    )}
                    <div className="group relative flex items-center">
                        <button type="button" aria-haspopup="true" className={`${NAV_LINK} cursor-default p-0 leading-[inherit]`}>
                            Experiments
                        </button>
                        <div className="invisible absolute left-1/2 top-full -translate-x-1/2 pt-4 opacity-0 transition-[opacity,visibility] duration-300 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
                            <ul className="panel flex w-[260px] flex-col gap-1 rounded-xl border border-hair p-2">
                                {EXPERIMENTS.map(({ label, description, href }) => (
                                    <li key={label}>
                                        <a href={href} className="block rounded-lg px-3 py-2 text-ink transition-colors duration-300 hover:text-gold focus-visible:text-gold">
                                            <span className="block text-label tracking-[.06em]">{label}</span>
                                            <span className="block text-sm text-ink-55">{description}</span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </nav>

                <div className="flex items-center gap-5">
                    {CONTOUR_BACKGROUND_ENABLED && <BackgroundToggle />}
                    <a href={LINKS.github} target="_blank" rel="noopener" className={NAV_LINK}>
                        GitHub
                    </a>
                </div>
            </div>
        </header>
    )
}
