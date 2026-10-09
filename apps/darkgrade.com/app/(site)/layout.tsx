import { Loader } from '@/app/components/loader'
import { SiteEffects } from '@/app/components/site-effects'
import { SiteFooter } from '@/app/components/site-footer'
import { SiteHeader } from '@/app/components/site-header'
import { WordmarkSprite } from '@/app/components/wordmark'

/**
 * Everything the site's pages share, mounted once: moving between pages swaps
 * only `children`, so the backdrop video keeps playing, the header and footer
 * stay put and the preloader never replays.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <WordmarkSprite />
            <SiteEffects />
            <Loader />
            <SiteHeader />

            <main className="relative z-[2]">
                {/* a 1px marker parked 40px down the document - the header
                    switches to its scrolled state when this leaves the viewport */}
                <span
                    id="top-mark"
                    aria-hidden="true"
                    className="pointer-events-none absolute top-10 left-0 h-px w-px"
                />
                {children}
                <SiteFooter />
            </main>
        </>
    )
}
