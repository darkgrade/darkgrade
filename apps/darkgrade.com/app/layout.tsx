import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

const instrumentSerif = localFont({
    src: [
        { path: './fonts/instrument-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
        { path: './fonts/instrument-serif-latin-400-italic.woff2', weight: '400', style: 'italic' },
    ],
    variable: '--font-instrument-serif',
    display: 'swap',
    preload: true,
    fallback: ['Georgia', 'serif'],
})

const interTight = localFont({
    src: [
        { path: './fonts/inter-tight-latin-wght-normal.woff2', weight: '100 900', style: 'normal' },
        { path: './fonts/inter-tight-latin-wght-italic.woff2', weight: '100 900', style: 'italic' },
    ],
    variable: '--font-inter-tight',
    display: 'swap',
    preload: true,
    fallback: ['system-ui', 'sans-serif'],
})

const jetbrainsMono = localFont({
    src: [
        { path: './fonts/jetbrains-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
        { path: './fonts/jetbrains-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    ],
    variable: '--font-jetbrains-mono',
    display: 'swap',
    preload: false,
    fallback: ['ui-monospace', 'monospace'],
})

const TITLE = 'Darkgrade — Shoot more. Edit less.'
const DESCRIPTION =
    'Local-first AI for making video. It dials in your camera, captures the shot, and turns raw footage into a finished first cut — on your own machine.'
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

/* CSS hides [data-fade]/[data-reveal] content, and locks scrolling behind the
   preloader, only under html.js / html.preload - so a visitor without
   JavaScript still gets the whole page, unlocked. This has to land before
   first paint, which means before hydration, which means <html>'s class
   attribute is deliberately not what the server sent: hence
   suppressHydrationWarning on it below. That opts out one element's own
   attributes, nothing nested. */
const JS_FLAG = "document.documentElement.classList.add('js','preload')"

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            className={`${interTight.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
            suppressHydrationWarning
        >
            <head>
                <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
            </head>
            <body className="[html.preload_&]:h-dvh [html.preload_&]:overflow-hidden">{children}</body>
        </html>
    )
}
