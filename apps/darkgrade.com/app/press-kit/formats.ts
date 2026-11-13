/**
 * Every image the press kit can draw.
 *
 * Dimensions were checked against the platforms' own help pages on 2026-10-08.
 */

export interface PixelRectangle {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

export type AssetLook =
    | 'banner'
    | 'card'
    | 'bench'
    | 'mark-on-backdrop'
    | 'mark-on-white'
    | 'mark-on-black'
    | 'mark-light-mode'
    | 'mark-dark-mode'

export interface AssetFormat {
    readonly id: string
    readonly tabLabel: string
    readonly platform: string
    readonly width: number
    readonly height: number
    readonly look: AssetLook
    /** Where banner content is centred, and where a card's words are set. Unused for the square marks. */
    readonly contentArea: PixelRectangle
    /** One line on what the image is for, shown under the preview. */
    readonly note: string
    /** What a bench card says: its name split where the lamp picks it up, what it does, and where it lives. */
    readonly words?: {
        readonly before: string
        readonly lit: string
        readonly description: string
        readonly address: string
    }
}

const SQUARE_SIZE = 1000

/** The link preview card, at twice the 1200 × 630 Open Graph asks for. */
const CARD_WIDTH = 2400
const CARD_HEIGHT = 1260
/** The words take the left of the card, inside a 150px margin; the camera in the picture behind them is on the right. */
const CARD_CONTENT_AREA: PixelRectangle = { x: 150, y: 150, width: 1060, height: 960 }

export const ASSET_FORMATS: readonly AssetFormat[] = [
    {
        id: 'link-card',
        tabLabel: 'Link preview',
        platform: 'The card that shows when darkgrade.com is shared',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        look: 'card',
        contentArea: CARD_CONTENT_AREA,
        note: 'The camera as Link drives it, with its four readings pinned to it, and the name and headline on the left.',
    },
    {
        id: 'linkedin-profile',
        tabLabel: 'LinkedIn profile',
        platform: 'LinkedIn · personal profile background',
        width: 1584,
        height: 396,
        look: 'banner',
        contentArea: { x: 340, y: 36, width: 1204, height: 300 },
        note: 'A profile photo sits over the lower left, so the words are set to the right of it.',
    },
    {
        id: 'linkedin-company',
        tabLabel: 'LinkedIn page',
        platform: 'LinkedIn · Page cover image',
        width: 1512,
        height: 256,
        look: 'banner',
        contentArea: { x: 260, y: 28, width: 1212, height: 200 },
        note: 'The page logo sits over the lower left, so the words are set to the right of it.',
    },
    {
        id: 'youtube-channel',
        tabLabel: 'YouTube',
        platform: 'YouTube · channel banner',
        width: 2560,
        height: 1440,
        look: 'banner',
        contentArea: { x: 507, y: 508.5, width: 1546, height: 423 },
        note: 'The words sit in the centre, the only part YouTube shows on every device.',
    },
    {
        id: 'x-header',
        tabLabel: 'X',
        platform: 'X · profile header',
        width: 1500,
        height: 500,
        look: 'banner',
        contentArea: { x: 400, y: 50, width: 1040, height: 330 },
        note: 'A profile photo sits over the lower left, and X crops the top and bottom a little on some screens.',
    },
    {
        id: 'square-backdrop',
        tabLabel: 'Square · backdrop',
        platform: 'The mark on the site backdrop',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-backdrop',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        note: 'For avatars and app tiles that want a full-bleed square.',
    },
    {
        id: 'square-light',
        tabLabel: 'Square · white',
        platform: 'The mark on solid white',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-white',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        note: 'For avatars and tiles that cannot take transparency, on light surfaces.',
    },
    {
        id: 'square-dark',
        tabLabel: 'Square · black',
        platform: 'The mark on solid black',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-black',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        note: 'For avatars and tiles that cannot take transparency, on dark surfaces.',
    },
    {
        id: 'mark-for-light',
        tabLabel: 'Mark · for light',
        platform: 'The mark alone, transparent',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-light-mode',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        note: 'Black on transparent. Use it on light backgrounds.',
    },
    {
        id: 'mark-for-dark',
        tabLabel: 'Mark · for dark',
        platform: 'The mark alone, transparent',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-dark-mode',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        note: 'White on transparent. Use it on dark backgrounds.',
    },
    {
        id: 'bench-toolbench',
        tabLabel: 'Toolbench',
        platform: 'Link preview card · darkgrade.com/toolbench',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        look: 'bench',
        contentArea: CARD_CONTENT_AREA,
        note: 'The card that shows when the toolbench page is shared.',
        words: {
            before: 'Tool',
            lit: 'bench.',
            description: 'Local models that make tool calls',
            address: 'darkgrade.com/toolbench',
        },
    },
    {
        id: 'bench-voicebench',
        tabLabel: 'Voicebench',
        platform: 'Link preview card · darkgrade.com/voicebench',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        look: 'bench',
        contentArea: CARD_CONTENT_AREA,
        note: 'The card that shows when the voicebench page is shared.',
        words: {
            before: 'Voice',
            lit: 'bench.',
            description: 'Speech models on real voices',
            address: 'darkgrade.com/voicebench',
        },
    },
    {
        id: 'bench-cambench',
        tabLabel: 'Cambench',
        platform: 'Link preview card · darkgrade.com/cambench',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        look: 'bench',
        contentArea: CARD_CONTENT_AREA,
        note: 'The card that shows when the cambench page is shared.',
        words: {
            before: 'Cam',
            lit: 'bench.',
            description: 'Camera specs, verified across sources',
            address: 'darkgrade.com/cambench',
        },
    },
]

export function getAssetFilename(format: AssetFormat): string {
    return `darkgrade-${format.id}-${format.width}x${format.height}.png`
}
