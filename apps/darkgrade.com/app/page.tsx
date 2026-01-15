import PerlinNoiseSimulation from '../components/PerlinNoiseSimulation'

export default function Home() {
    return (
        <div className="w-full h-screen relative">
            {/* Logo in upper left */}
            <div className="absolute top-0 left-0 z-[1000] text-white gap-[12px] flex items-center p-[24px] md:p-[64px]">
                <img src="/plus_darkgrade_light.svg" alt="darkgrade" className="h-[20px] object-contain" />
            </div>

            {/* Menu in upper right */}
            <div className="absolute top-0 right-0 z-[1000] text-white gap-[12px] hidden md:flex items-center p-[24px] md:p-[64px]">
                <a
                    href="https://coblocks-86fbefb0.mintlify.app/"
                    target="_blank"
                    className="text-white text-[14px] font-sans tracking-[6px] uppercase font-medium leading-none"
                >
                    Docs
                </a>
            </div>

            {/* GitHub link in center */}
            <div className="absolute top-0 left-0 z-[1000] w-full h-full flex flex-col justify-center p-[24px] md:p-[64px] max-w-[800px] gap-[16px] md:gap-[24px]">
                <h1 className="text-white text-[32px] leading-[40px] md:text-[72px] md:leading-[84px] font-medium font-sans tracking-tighter text-balance text-left">
                    Let your camera understand the world
                </h1>
                <h2 className="text-white text-[16px] leading-[22px] md:text-[22px] md:leading-[28px] font-normal font-sans tracking-tight text-balance text-left">
                    We're building a protocol for large language models to directly interface with image sensors.
                </h2>
                <a href="https://github.com/darkgrade" target="_blank" rel="noopener noreferrer" className="mt-4">
                    <svg width="28" height="28" viewBox="0 0 98 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <g clipPath="url(#clip0_3_12)">
                            <path
                                fillRule="evenodd"
                                clipRule="evenodd"
                                d="M48.854 0C21.839 0 0 22 0 49.217C0 70.973 13.993 89.389 33.405 95.907C35.832 96.397 36.721 94.848 36.721 93.545C36.721 92.404 36.641 88.493 36.641 84.418C23.051 87.352 20.221 78.551 20.221 78.551C18.037 72.847 14.801 71.381 14.801 71.381C10.353 68.366 15.125 68.366 15.125 68.366C20.059 68.692 22.648 73.418 22.648 73.418C27.015 80.914 34.052 78.796 36.883 77.492C37.287 74.314 38.582 72.114 39.957 70.892C29.118 69.751 17.714 65.514 17.714 46.609C17.714 41.231 19.654 36.831 22.728 33.409C22.243 32.187 20.544 27.134 23.214 20.371C23.214 20.371 27.339 19.067 36.64 25.423C40.6221 24.3457 44.7288 23.7976 48.854 23.793C52.979 23.793 57.184 24.364 61.067 25.423C70.369 19.067 74.494 20.371 74.494 20.371C77.164 27.134 75.464 32.187 74.979 33.409C78.134 36.831 79.994 41.231 79.994 46.609C79.994 65.514 68.59 69.669 57.67 70.892C59.45 72.44 60.986 75.373 60.986 80.018C60.986 86.618 60.906 91.915 60.906 93.544C60.906 94.848 61.796 96.397 64.222 95.908C83.634 89.388 97.627 70.973 97.627 49.217C97.707 22 75.788 0 48.854 0Z"
                                fill="white"
                            />
                        </g>
                        <defs>
                            <clipPath id="clip0_3_12">
                                <rect width="98" height="96" fill="white" />
                            </clipPath>
                        </defs>
                    </svg>
                </a>
            </div>

            {/* Perlin noise simulation as background */}
            <div className="absolute top-0 left-0 w-full h-full opacity-15">
                <PerlinNoiseSimulation />
            </div>
        </div>
    )
}
