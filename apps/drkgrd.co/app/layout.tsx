import { MUX_STREAM_ORIGIN } from '@/app/components/mux'
import type { Metadata, Viewport } from 'next'
import { Fragment_Mono, Public_Sans } from 'next/font/google'
import './globals.css'

// The same two faces darkgrade.com is set in: Public Sans for headings and running text,
// Fragment Mono for labels. Fragment Mono has one weight, so nothing set in it may ask for a bold.
const siteSans = Public_Sans({ subsets: ['latin'], variable: '--font-site-sans', display: 'swap' })
const siteMono = Fragment_Mono({ subsets: ['latin'], weight: '400', variable: '--font-site-mono', display: 'swap' })

const TITLE = 'Darkgrade — Shoot more. Edit less.'
const DESCRIPTION = 'Local-first AI for creative professionals.'

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
        type: 'website',
        url: 'https://drkgrd.co',
    },
    twitter: {
        card: 'summary_large_image',
        title: TITLE,
        description: DESCRIPTION,
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
        <html lang="en" className={`${siteSans.variable} ${siteMono.variable}`}>
            <head>
                <link rel="preconnect" href={MUX_STREAM_ORIGIN} />
            </head>
            <body>{children}</body>
        </html>
    )
}
