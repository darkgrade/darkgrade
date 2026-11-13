import { DEV_FONT_BOOTSTRAP_SCRIPT } from '@/app/components/dev-font-chooser/dev-fonts'
import { DevTools } from '@/app/components/dev-font-chooser/dev-tools'
import type { Metadata, Viewport } from 'next'
import { Fragment_Mono, Public_Sans } from 'next/font/google'
import './globals.css'

/* The font chooser exists only under `next dev`; the component additionally
   checks for a localhost hostname, so it never shows on a LAN address. */
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'

// Public Sans for headings and running text alike, and Fragment Mono for labels, readings and
// code. Fragment Mono has one weight, so nothing set in it may ask for a bold.
const siteSans = Public_Sans({ subsets: ['latin'], variable: '--font-site-sans', display: 'swap' })
const siteMono = Fragment_Mono({ subsets: ['latin'], weight: '400', variable: '--font-site-mono', display: 'swap' })

const TITLE = 'Darkgrade — Shoot more. Edit less.'
const DESCRIPTION = 'Local-first AI for creative professionals.'
const OG_IMAGE = 'https://darkgrade.com/darkgrade_opengraph_dark.png'

export const metadata: Metadata = {
    metadataBase: new URL('https://darkgrade.com'),
    title: TITLE,
    description: DESCRIPTION,
    applicationName: 'Darkgrade',
    keywords: [
        'camera control',
        'local-first AI',
        'video editing',
        'automatic first cut',
        'tethered capture',
        'Sony',
        'Nikon',
        'Canon',
        'open source',
    ],
    alternates: { canonical: '/' },
    icons: {
        icon: [{ url: '/darkgrade_favicon_dark.svg', type: 'image/svg+xml' }],
    },
    openGraph: {
        title: TITLE,
        siteName: TITLE,
        description: DESCRIPTION,
        images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: 'Darkgrade' }],
        type: 'website',
        url: 'https://darkgrade.com',
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

/* CSS hides content that animates in ([data-rise]) only under html.js, so a visitor without JavaScript still gets the whole
   page. This has to land before first paint, which means before hydration,
   which means <html>'s class attribute is deliberately not what the server
   sent: hence suppressHydrationWarning on it below. That opts out one
   element's own attributes, nothing nested. */
const JS_FLAG = "document.documentElement.classList.add('js')"

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${siteSans.variable} ${siteMono.variable}`} suppressHydrationWarning>
            <head>
                <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
                {IS_DEVELOPMENT && <script dangerouslySetInnerHTML={{ __html: DEV_FONT_BOOTSTRAP_SCRIPT }} />}
            </head>
            <body>
                {children}
                {IS_DEVELOPMENT && <DevTools />}
            </body>
        </html>
    )
}
