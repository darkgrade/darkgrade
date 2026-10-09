import { Acts } from '@/app/components/acts'
import { Dream } from '@/app/components/dream'
import { Hero } from '@/app/components/hero'
import { Manifesto } from '@/app/components/manifesto'
import { Marquee } from '@/app/components/marquee'
import { Principles } from '@/app/components/principles'
import { Stats } from '@/app/components/stats'

export default function Home() {
    return (
        <>
            <Hero />
            <Marquee />
            <Manifesto />
            <Acts />
            <Stats />
            <Principles />
            <Dream />
        </>
    )
}
