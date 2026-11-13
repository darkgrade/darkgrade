import { backdropDataURI, CARD_SIZE, darkgradeMark, OgCard } from '@kevinschaich/components/og'
import { ImageResponse } from 'next/og'

/**
 * A link preview card for one of the site's sheet pages. The home page keeps its own card — the
 * camera from its scene, which Satori cannot draw — so this is for everything else: About, Blog,
 * Careers, Changelog, Press kit and Privacy, each naming itself instead of inheriting the camera.
 */
export const CARD_CONTENT_TYPE = 'image/png'
export const CARD_SIZE_PIXELS = CARD_SIZE

/**
 * One face, fetched while the card is drawn. A path into a package does not survive the route
 * being bundled, which is why these come over the network rather than out of node_modules.
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

/** Draws the card: the lockup, the page's name, what it is, and its address, over the site's dust. */
export async function drawPageCard({ main, sub, path }: { main: string; sub: string; path: string }) {
    const [fonts, background] = await Promise.all([
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
            main={main}
            sub={sub}
            address={`darkgrade.com${path}`}
            background={background}
        />,
        { ...CARD_SIZE, fonts }
    )
}
