import { backdropDataURI, CARD_SIZE, darkgradeMark, OgCard } from '@kevinschaich/components/og'
import { ImageResponse } from 'next/og'

/**
 * The link preview card, drawn at build time rather than committed as a PNG: the shared card every
 * Darkgrade and Kevinschaich property uses, over the home page's own dust.
 */
export const alt = 'Darkgrade — Shoot more. Edit less.'
export const size = CARD_SIZE
export const contentType = 'image/png'

/**
 * One face, fetched from Google Fonts while the card is drawn. The files are read over the network
 * rather than resolved out of node_modules because this route is bundled, and a path into a package
 * does not survive that.
 */
async function face(family: string, weight: 400 | 500 | 600, name: 'body' | 'heading' | 'mono') {
    const stylesheet = await fetch(
        `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
        // An old user agent makes Google serve TTF, which is what Satori reads.
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30' }, cache: 'no-store' }
    ).then(response => response.text())
    const source = stylesheet.match(/src: url\((.+?)\)/)?.[1]
    if (!source) throw new Error(`No font file for ${family} ${weight}`)
    const data = await fetch(source).then(response => response.arrayBuffer())
    return { name, weight, style: 'normal' as const, data }
}

export default async function OpenGraphImage() {
    const [fonts, backdrop] = await Promise.all([
        Promise.all([
            face('Public Sans', 400, 'body'),
            face('Public Sans', 500, 'heading'),
            face('Public Sans', 600, 'heading'),
            face('Fragment Mono', 400, 'mono'),
        ]),
        backdropDataURI(),
    ])

    return new ImageResponse(
        <OgCard
            logo={{ mark: darkgradeMark.dark, name: 'Darkgrade' }}
            main="Shoot more. Edit less."
            sub="Local-first AI for creative professionals"
            address="drkgrd.co"
            background={backdrop}
        />,
        { ...size, fonts }
    )
}
