import { CTA, PerlinNoiseSimulation } from '@darkgrade/ui'
import Link from 'next/link'

export default function Home() {
    return (
        <div className="relative overflow-x-hidden">
            <div className="mx-auto m-8 md:m-16 text-white flex flex-col items-center gap-6 relative z-10">
                <div className="opacity-90 border border-[#4D4D4D] bg-[#1A1A1A] rounded-md w-24 h-24 flex items-center justify-center">
                    <img src={process.env.NEXT_PUBLIC_DOMAIN === 'drkgrd.co' ? '/darkgrade_icon_dark.svg' : '/ks_icon_dark.svg'} alt={process.env.NEXT_PUBLIC_DOMAIN} className="w-12 h-12 rounded-md" />
                </div>
                {process.env.NEXT_PUBLIC_DOMAIN === 'kevinschaich.com' && <h1 className="text-3xl font-bold">👋&nbsp;&nbsp;Hi, I'm Kevin.</h1>}
                {process.env.NEXT_PUBLIC_DOMAIN === 'kevinschaich.com' && (
                    <h2 className="text-lg text-[#666666] max-w-[400px] text-center text-balance">
                        Building cool shit @{' '}
                        <Link href="https://darkgrade.com" target="_blank" className="underline text-[#aaaaaa]">
                            Darkgrade
                        </Link>
                        .<br /> Prev. @ Palantir / Cornell CS
                    </h2>
                )}
                <CTA />
            </div>

            {/* Perlin noise simulation as background */}
            <div className="fixed inset-0 opacity-20 pointer-events-none">
                <PerlinNoiseSimulation />
            </div>
        </div>
    )
}
