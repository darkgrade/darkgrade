import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { MUX_STREAM_ORIGIN } from '@/app/components/mux'
import './globals.css'

const tayFlapjack = localFont({
    src: [{ path: './fonts/tay-flapjack.woff2', weight: '400', style: 'normal' }],
    variable: '--font-tay-flapjack',
    display: 'swap',
    preload: true,
    fallback: ['Georgia', 'serif'],
})

const tayRoadRunner = localFont({
    src: [{ path: './fonts/tay-road-runner-regular.woff2', weight: '400', style: 'normal' }],
    variable: '--font-tay-road-runner',
    display: 'swap',
    preload: true,
    fallback: ['system-ui', 'sans-serif'],
})

const tayTommyTokyo = localFont({
    src: [{ path: './fonts/tay-tommy-tokyo-regular.woff2', weight: '400', style: 'normal' }],
    variable: '--font-tay-tommy-tokyo',
    display: 'swap',
    preload: true,
    fallback: ['ui-monospace', 'monospace'],
})

const TITLE = 'Darkgrade — Shoot more. Edit less.'
const DESCRIPTION = 'Local-first AI for creative professionals.'
const OG_IMAGE = 'https://drkgrd.co/darkgrade_opengraph_dark.png'

export const metadata: Metadata = {
    metadataBase: new URL('https://drkgrd.co'),
    title: TITLE,
    description: DESCRIPTION,
    applicationName: 'Darkgrade',
    alternates: { canonical: 'https://darkgrade.com' },
    icons: {
        icon: [{ url: '/darkgrade_favicon_dark.svg', type: 'image/svg+xml' }],
    },
    openGraph: {
        title: TITLE,
        siteName: TITLE,
        description: DESCRIPTION,
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'Darkgrade' }],
        type: 'website',
        url: 'https://drkgrd.co',
    },
    twitter: {
        card: 'summary_large_image',
        title: TITLE,
        description: DESCRIPTION,
        images: [OG_IMAGE],
    },
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    themeColor: '#0A0A0B',
    colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${tayRoadRunner.variable} ${tayFlapjack.variable} ${tayTommyTokyo.variable}`}>
            <head>
                <link rel="preconnect" href={MUX_STREAM_ORIGIN} />
            </head>
            <body>{children}</body>
        </html>
    )
}
