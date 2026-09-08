import { BackgroundToggle } from './background-toggle'
import { CONTOUR_BACKGROUND_ENABLED } from './backgrounds/field'
import { LINKS } from './site-links'
import { Wordmark } from './wordmark'

/** JS toggles `.scrolled` on the header once the top marker leaves the viewport. */
const NAV = [
    { label: 'Product', href: '#product' },
    { label: 'Roadmap', href: '#roadmap' },
    { label: 'Principles', href: '#principles' },
    { label: 'Docs', href: LINKS.docs, external: true },
]

const NAV_LINK =
    'relative text-[13px] font-[420] tracking-[.06em] text-ink-55 transition-[color,text-shadow] duration-300 hover:text-ink hover:[text-shadow:0_0_12px_rgba(244,198,110,.35)] ' +
    "after:absolute after:-bottom-[5px] after:left-0 after:h-px after:w-full after:origin-right after:scale-x-0 after:bg-gold after:shadow-[0_0_9px_rgba(244,198,110,.55)] after:transition-transform after:duration-[450ms] after:ease-lamp after:content-[''] " +
    'hover:after:origin-left hover:after:scale-x-100'

export function SiteHeader() {
    return (
        <header
            id="hdr"
            className="fixed inset-x-0 top-0 z-[80] transition-[background,backdrop-filter] duration-500 [&.scrolled]:bg-[rgba(10,10,11,.72)] [&.scrolled]:backdrop-blur-[14px]"
        >
            <div className="shell flex h-[76px] items-center justify-between transition-[height] duration-500 ease-lamp [.scrolled_&]:h-[64px]">
                <a href="#" aria-label="Darkgrade" className="block text-ink">
                    <Wordmark className="mark-glow block h-[17px] w-auto" />
                </a>

                <nav className="flex gap-[38px] max-[900px]:hidden">
                    {NAV.map(({ label, href, external }) => (
                        <a
                            key={label}
                            href={href}
                            className={NAV_LINK}
                            {...(external ? { target: '_blank', rel: 'noopener' } : {})}
                        >
                            {label}
                        </a>
                    ))}
                </nav>

                <div className="flex items-center gap-5">
                    {CONTOUR_BACKGROUND_ENABLED && <BackgroundToggle />}
                    <a
                        href={LINKS.github}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-[10px] rounded-full border border-hair px-5 py-[11px] text-[12.5px] font-[460] tracking-[.08em] transition-[border-color,background,color,box-shadow] duration-[350ms] hover:border-gold hover:text-gold hover:shadow-[0_0_26px_rgba(244,198,110,.16)]"
                    >
                        <span className="text-gold [text-shadow:0_0_8px_rgba(244,198,110,calc(.7*var(--gI)))]">✦</span>{' '}
                        Star on GitHub
                    </a>
                </div>
            </div>
        </header>
    )
}
