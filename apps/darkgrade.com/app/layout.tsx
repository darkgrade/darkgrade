import { Geist as SansFont } from 'next/font/google'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'

const sans = SansFont({
    subsets: ['latin'],
    variable: '--font-sans',
    weight: ['400', '500', '600'],
})

export const metadata = {
    title: 'darkgrade',
    description: 'darkgrade',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className="h-screen overflow-hidden w-full m-0 p-0 bg-black">
            <head>
                <meta charSet="utf-8" />
                <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
                <meta name="viewport" content="width=device-width" />
                <title>Darkgrade | Let your camera understand the world</title>
                <meta
                    name="description"
                    content="Let your camera understand the world. We're building a protocol for large language models to directly interface with image sensors."
                />
                <meta property="og:title" content="darkgrade" />
                <meta
                    property="og:description"
                    content="Let your camera understand the world. We're building a protocol for large language models to directly interface with image sensors."
                />
                <meta property="og:image" content="https://darkgrade.com/opengraph.jpg" />
                <meta property="og:type" content="website" />
                <meta property="og:url" content="https://darkgrade.com" />
                <meta name="twitter:card" content="summary_large_image" />
            </head>
            <body
                className={`${sans.variable} flex flex-col overflow-hidden w-full h-screen relative m-0 p-0 border-none`}
            >
                {children}
                <Analytics />
                <SpeedInsights />
            </body>
        </html>
    )
}
