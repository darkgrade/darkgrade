import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { DevTools } from '@/app/components/dev-font-chooser/dev-tools'
import { DEV_FONT_BOOTSTRAP_SCRIPT } from '@/app/components/dev-font-chooser/dev-fonts'
import './globals.css'

/* The font chooser exists only under `next dev`; the component additionally
   checks for a localhost hostname, so it never shows on a LAN address. */
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'

// All four TAY faces are static Regular (400) only. Weight utilities in the page
// (font-[340], font-[460], font-medium) all resolve to that one face; nothing on
// the page asks for 600+, so no bold is ever synthesised. Italic IS synthesised
// (a slant of the upright) because none of these ship an italic.
//
// Glyph coverage is basic Latin: © · α — ✓ are missing from some or all of them
// and fall through the `fallback` stacks below.
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

// Mono: QuickDraw is live. To switch to Tommy Tokyo, point `path` at
// './fonts/tay-tommy-tokyo-regular.woff2' (already in ./fonts, currently unused).
const tayQuickDraw = localFont({
    src: [{ path: './fonts/tay-quick-draw.woff2', weight: '400', style: 'normal' }],
    variable: '--font-tay-quick-draw',
    display: 'swap',
    // Preloaded: it sets the eyebrow labels, chips and "tested on" line, all above the fold.
    preload: true,
    fallback: ['ui-monospace', 'monospace'],
})

const TITLE = 'Darkgrade — Shoot more. Edit less.'
const DESCRIPTION =
    'Local-first AI for creative professionals.'
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
            className={`${tayRoadRunner.variable} ${tayFlapjack.variable} ${tayQuickDraw.variable}`}
            suppressHydrationWarning
        >
            <head>
                <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
                {IS_DEVELOPMENT && <script dangerouslySetInnerHTML={{ __html: DEV_FONT_BOOTSTRAP_SCRIPT }} />}
            </head>
            <body className="[html.preload_&]:h-dvh [html.preload_&]:overflow-hidden">
                {children}
                {IS_DEVELOPMENT && <DevTools />}
            </body>
        </html>
    )
}
