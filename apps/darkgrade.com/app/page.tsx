import { Acts } from './components/acts'
import { Dream } from './components/dream'
import { Hero } from './components/hero'
import { Loader } from './components/loader'
import { Manifesto } from './components/manifesto'
import { Marquee } from './components/marquee'
import { Principles } from './components/principles'
import { Roadmap } from './components/roadmap'
import { SiteEffects } from './components/site-effects'
import { SiteFooter } from './components/site-footer'
import { SiteHeader } from './components/site-header'
import { Stats } from './components/stats'
import { WordmarkSprite } from './components/wordmark'

export default function Home() {
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
                    className="pointer-events-none absolute left-0 top-10 h-px w-px"
                />

                <Hero />
                <Marquee />
                <Manifesto />
                <Acts />
                <Stats />
                <Roadmap />
                <Principles />
                <Dream />
                <SiteFooter />
            </main>
        </>
    )
}
