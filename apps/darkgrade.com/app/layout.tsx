import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { DevTools } from '@/app/components/dev-font-chooser/dev-tools'
import { DEV_FONT_BOOTSTRAP_SCRIPT } from '@/app/components/dev-font-chooser/dev-fonts'
import { VIDEO_BACKGROUND_ENABLED } from '@/app/components/backgrounds/field'
import { YOUTUBE_IFRAME_API_URL } from '@/app/components/backgrounds/youtube'
import './globals.css'

/* The font chooser exists only under `next dev`; the component additionally
   checks for a localhost hostname, so it never shows on a LAN address. */
const IS_DEVELOPMENT = process.env.NODE_ENV === 'development'

// All four TAY faces are static Regular (400) only. Weight utilities in the page
// (font-[340], font-[460], font-medium) all resolve to that one face; nothing on
// the page asks for 600+, so no bold is ever synthesised. Italic IS synthesised
// (a slant of the upright) because none of these ship an italic.
//
// Glyph coverage is basic Latin: © (and a few others) are missing from some or all
// of them and fall through the `fallback` stacks below. Anything decorative or
// displayed large is drawn instead (the star, the stat dash, the separator dots).
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

// Mono: Tommy Tokyo is live. To switch back to Quick Draw, point `path` at
// './fonts/tay-quick-draw.woff2' (still in ./fonts, currently unused).
const tayTommyTokyo = localFont({
    src: [{ path: './fonts/tay-tommy-tokyo-regular.woff2', weight: '400', style: 'normal' }],
    variable: '--font-tay-tommy-tokyo',
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
   attributes, nothing nested.

   The preloader plays only when a visit lands on the home page: html.intro
   shows it and html.preload locks scrolling behind it. Landing anywhere else,
   or moving between pages afterwards (client-side, in the (site) layout), never
   shows it. */
const JS_FLAG =
    "var c=document.documentElement.classList;c.add('js');if(location.pathname==='/')c.add('intro','preload')"

/* The backdrop video starts loading at first paint, behind the preloader,
   instead of after hydration: the YouTube API script is requested from here,
   and the connections it needs are opened ahead of it. Reduced motion never
   plays the video, so it never fetches the player either. */
const VIDEO_PRELOAD = `if(!matchMedia('(prefers-reduced-motion: reduce)').matches){var s=document.createElement('script');s.src='${YOUTUBE_IFRAME_API_URL}';s.async=true;document.head.appendChild(s)}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            className={`${tayRoadRunner.variable} ${tayFlapjack.variable} ${tayTommyTokyo.variable}`}
            suppressHydrationWarning
        >
            <head>
                <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
                {VIDEO_BACKGROUND_ENABLED && (
                    <>
                        <link rel="preconnect" href="https://www.youtube.com" />
                        <link rel="preconnect" href="https://www.youtube-nocookie.com" />
                        <script dangerouslySetInnerHTML={{ __html: VIDEO_PRELOAD }} />
                    </>
                )}
                {IS_DEVELOPMENT && <script dangerouslySetInnerHTML={{ __html: DEV_FONT_BOOTSTRAP_SCRIPT }} />}
            </head>
            <body className="[html.preload_&]:h-dvh [html.preload_&]:overflow-hidden">
                {children}
                {IS_DEVELOPMENT && <DevTools />}
            </body>
        </html>
    )
}
