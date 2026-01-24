import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import localFont from 'next/font/local'
import './globals.css'

const sans = localFont({
    src: './fonts/GoogleSansFlex.woff2',
    preload: true,
    display: 'swap',
})

export const metadata = {
    title: 'Darkgrade | Let your camera understand the world',
    description:
        "Let your camera understand the world. We're building a protocol for large language models to directly interface with image sensors.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${sans.className} h-screen overflow-hidden w-full m-0 p-0 bg-black`}>
            <head>
                <meta charSet="utf-8" />
                <link rel="icon" type="image/svg+xml" href="/darkgrade_favicon_dark.svg" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />

                <meta property="og:title" content="Darkgrade | Let your camera understand the world" />
                <meta
                    property="og:description"
                    content="Let your camera understand the world. We're building a protocol for large language models to directly interface with image sensors."
                />
                <meta property="og:image" content="https://darkgrade.com/darkgrade_opengraph_dark.png" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://darkgrade.com" />
                <meta name="twitter:card" content="summary_large_image" />
            </head>
            <body className="flex flex-col overflow-hidden w-full h-screen relative m-0 p-0 border-none">
                {children}
                <Analytics />
                <SpeedInsights />
            </body>
        </html>
    )
}
