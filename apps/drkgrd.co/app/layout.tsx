import localFont from 'next/font/local'
import './globals.css'

const sans = localFont({
    src: './fonts/GoogleSansFlex.woff2',
    preload: true,
    display: 'swap',
})

export const metadata = {
    title: process.env.NEXT_PUBLIC_DOMAIN,
    description: process.env.NEXT_PUBLIC_DOMAIN,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${sans.className} bg-black overflow-x-hidden`}>
            <head>
                <meta charSet="utf-8" />
                <link
                    rel="icon"
                    type="image/svg+xml"
                    href={
                        process.env.NEXT_PUBLIC_DOMAIN === 'drkgrd.co'
                            ? '/darkgrade_favicon_dark.svg'
                            : '/ks_favicon_dark.svg'
                    }
                />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />

                <meta property="og:title" content={process.env.NEXT_PUBLIC_DOMAIN} />
                <meta property="og:site_name" content={process.env.NEXT_PUBLIC_DOMAIN} />
                <meta property="og:description" content={process.env.NEXT_PUBLIC_DOMAIN} />
                <meta
                    property="og:image"
                    content={
                        process.env.NEXT_PUBLIC_DOMAIN === 'drkgrd.co'
                            ? 'https://' + process.env.NEXT_PUBLIC_DOMAIN + '/darkgrade_opengraph_dark.png'
                            : 'https://' + process.env.NEXT_PUBLIC_DOMAIN + '/ks_opengraph_dark.png'
                    }
                />
                <meta property="og:type" content="website" />
                <meta property="og:url" content={'https://' + process.env.NEXT_PUBLIC_DOMAIN} />

                <meta
                    property="twitter:image"
                    content={
                        process.env.NEXT_PUBLIC_DOMAIN === 'drkgrd.co'
                            ? 'https://' + process.env.NEXT_PUBLIC_DOMAIN + '/darkgrade_opengraph_dark.png'
                            : 'https://' + process.env.NEXT_PUBLIC_DOMAIN + '/ks_opengraph_dark.png'
                    }
                />
                <meta property="twitter:title" content={process.env.NEXT_PUBLIC_DOMAIN} />
                <meta property="twitter:description" content={process.env.NEXT_PUBLIC_DOMAIN} />
                <meta name="twitter:card" content="summary_large_image" />
            </head>
            <body className="overflow-x-hidden">{children}</body>
        </html>
    )
}
