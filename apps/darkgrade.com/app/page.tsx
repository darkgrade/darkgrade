import { CTA, PerlinNoiseSimulation } from '@darkgrade/ui'

export default function Home() {
    return (
        <div className="w-full h-screen relative">
            {/* Logo and menu */}
            <div className="absolute top-0 left-0 right-0 z-1000 text-white flex items-center justify-between p-[24px] md:p-[64px]">
                <img src="/darkgrade_combo_dark.svg" alt="darkgrade" className="h-[20px] object-contain" />
                <a
                    href="https://darkgrade.com/docs"
                    target="_blank"
                    className="text-white text-[16px] font-medium leading-none"
                >
                    Docs
                </a>    
            </div>

            {/* GitHub link in center */}
            <div className="absolute top-0 left-0 z-1000 w-full h-full flex flex-col justify-center p-[24px] md:p-[64px] max-w-[600px] md:max-w-[800px] gap-[16px] md:gap-[24px]">
                <h1 className="text-white text-[32px] leading-[40px] md:text-[64px] md:leading-[72px] font-medium tracking-tighter text-balance text-left">
                    Let your camera understand the world
                </h1>
                <h2 className="text-white text-[16px] leading-[20px] md:text-[18px] md:leading-[24px] font-regular tracking-tight text-balance text-left mb-4">
                    We're building a protocol for large language models to directly interface with image sensors.
                </h2>
                <CTA />
            </div>

            {/* Perlin noise simulation as background */}
            <div className="fixed inset-0 opacity-20 pointer-events-none">
                <PerlinNoiseSimulation />
            </div>
        </div>
    )
}
