/**
 * Every image the /social studio can produce.
 *
 * Dimensions were checked against the platforms' own help pages on 2026-10-08;
 * `source` says where each number came from so they can be re-checked when a
 * platform changes them.
 */

export interface PixelRectangle {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
}

export interface Guide {
    /** 'safe' = keep content inside; 'covered' = the platform draws something over it. */
    readonly kind: 'safe' | 'covered'
    readonly label: string
    readonly rectangle: PixelRectangle
}

export type AssetLook =
    'banner' | 'mark-on-video' | 'mark-on-white' | 'mark-on-black' | 'mark-light-mode' | 'mark-dark-mode'

export interface AssetFormat {
    readonly id: string
    readonly tabLabel: string
    readonly platform: string
    readonly width: number
    readonly height: number
    readonly look: AssetLook
    /** Overrides the generated filename, to match an existing file in /public. */
    readonly filename?: string
    /** Where banner content is centred. Unused for the square marks. */
    readonly contentArea: PixelRectangle
    readonly guides: readonly Guide[]
    readonly fileNote: string
    readonly source: { readonly label: string; readonly url: string }
    /** Shown under the preview. */
    readonly notes: readonly string[]
}

const SQUARE_SIZE = 1000

/** The size of the cards in /public (darkgrade_opengraph_dark.png, ..._light.png). */
const OPENGRAPH_WIDTH = 2400
const OPENGRAPH_HEIGHT = 1260
/** The same stacked composition as the banners, inside a 150px margin. */
const OPENGRAPH_CONTENT_AREA: PixelRectangle = { x: 150, y: 150, width: 2100, height: 960 }

export const ASSET_FORMATS: readonly AssetFormat[] = [
    {
        id: 'linkedin-profile',
        tabLabel: 'LinkedIn profile',
        platform: 'LinkedIn · personal profile background',
        width: 1584,
        height: 396,
        look: 'banner',
        contentArea: { x: 340, y: 36, width: 1204, height: 300 },
        guides: [
            {
                kind: 'covered',
                label: 'profile photo (approx.)',
                rectangle: { x: 0, y: 262, width: 300, height: 134 },
            },
        ],
        fileNote: 'PNG or JPG (no GIFs)',
        source: {
            label: 'LinkedIn Help · Photo won’t upload to your profile',
            url: 'https://www.linkedin.com/help/linkedin/answer/a549049',
        },
        notes: ['Your profile photo sits over the lower-left, so the content is centred to the right of it.'],
    },
    {
        id: 'linkedin-company',
        tabLabel: 'LinkedIn company',
        platform: 'LinkedIn · Page cover image',
        width: 1512,
        height: 256,
        look: 'banner',
        contentArea: { x: 260, y: 28, width: 1212, height: 200 },
        guides: [
            {
                kind: 'covered',
                label: 'page logo (approx.)',
                rectangle: { x: 0, y: 150, width: 240, height: 106 },
            },
        ],
        fileNote: 'PNG or JPEG, 3 MB max',
        source: {
            label: 'LinkedIn Help · Image specifications for your LinkedIn Pages',
            url: 'https://www.linkedin.com/help/linkedin/answer/a563309',
        },
        notes: ['LinkedIn asks for limited text and key details away from the edges, especially the lower right.'],
    },
    {
        id: 'youtube-channel',
        tabLabel: 'YouTube',
        platform: 'YouTube · channel banner',
        width: 2560,
        height: 1440,
        look: 'banner',
        contentArea: { x: 507, y: 508.5, width: 1546, height: 423 },
        guides: [
            {
                kind: 'safe',
                label: 'safe area on every device · 1546 × 423',
                rectangle: { x: 507, y: 508.5, width: 1546, height: 423 },
            },
        ],
        fileNote: 'Minimum 2048 × 1152 (16:9), 6 MB max',
        source: {
            label: 'YouTube Help · Channel art',
            url: 'https://support.google.com/youtube/answer/2972003',
        },
        notes: [
            'Only the centred 1546 × 423 area is guaranteed to show on TV, desktop, tablet and mobile.',
            'The YouTube help page is rendered by script, so these figures were cross-checked against several guides that quote it.',
        ],
    },
    {
        id: 'x-header',
        tabLabel: 'X / Twitter',
        platform: 'X · profile header',
        width: 1500,
        height: 500,
        look: 'banner',
        contentArea: { x: 400, y: 50, width: 1040, height: 330 },
        guides: [
            {
                kind: 'covered',
                label: 'profile photo (approx.)',
                rectangle: { x: 0, y: 320, width: 390, height: 180 },
            },
        ],
        fileNote: 'JPEG, GIF or PNG',
        source: {
            label: 'X Help · Common issues when uploading a profile photo',
            url: 'https://help.x.com/en/managing-your-account/common-issues-when-uploading-profile-photo',
        },
        notes: ['X crops the header a little at the top and bottom on some screens.'],
    },
    {
        id: 'opengraph-dark',
        tabLabel: 'OpenGraph · dark',
        platform: 'Link preview card · dark',
        width: OPENGRAPH_WIDTH,
        height: OPENGRAPH_HEIGHT,
        look: 'banner',
        filename: 'darkgrade_opengraph_dark.png',
        contentArea: OPENGRAPH_CONTENT_AREA,
        guides: [],
        fileNote: 'PNG · replaces public/darkgrade_opengraph_dark.png',
        source: { label: 'Open Graph protocol', url: 'https://ogp.me/#structured' },
        notes: [
            'The size of the cards already in /public, in the same layout as the banners. Dark and light are the same image: the site has no light mode.',
        ],
    },
    {
        id: 'opengraph-light',
        tabLabel: 'OpenGraph · light',
        platform: 'Link preview card · light',
        width: OPENGRAPH_WIDTH,
        height: OPENGRAPH_HEIGHT,
        look: 'banner',
        filename: 'darkgrade_opengraph_light.png',
        contentArea: OPENGRAPH_CONTENT_AREA,
        guides: [],
        fileNote: 'PNG · replaces public/darkgrade_opengraph_light.png',
        source: { label: 'Open Graph protocol', url: 'https://ogp.me/#structured' },
        notes: ['Identical to the dark card, saved under the light filename.'],
    },
    {
        id: 'square-background',
        tabLabel: 'Square · background',
        platform: 'Square mark on the video background',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-video',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        guides: [],
        fileNote: 'PNG, opaque',
        source: { label: 'Darkgrade brand', url: 'https://darkgrade.com' },
        notes: [
            'The icon on a frame of the site background video, for avatars and app tiles that want a full-bleed square.',
        ],
    },
    {
        id: 'square-light',
        tabLabel: 'Square · light',
        platform: 'Square mark on white · for light surfaces',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-white',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        guides: [],
        fileNote: 'PNG, opaque',
        source: { label: 'Darkgrade brand', url: 'https://darkgrade.com' },
        notes: ['The black mark on solid white, for avatars and tiles that cannot take transparency.'],
    },
    {
        id: 'square-dark',
        tabLabel: 'Square · dark',
        platform: 'Square mark on black · for dark surfaces',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-on-black',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        guides: [],
        fileNote: 'PNG, opaque',
        source: { label: 'Darkgrade brand', url: 'https://darkgrade.com' },
        notes: ['The white mark on solid black, for avatars and tiles that cannot take transparency.'],
    },
    {
        id: 'square-transparent-light',
        tabLabel: 'Square · transparent light',
        platform: 'Square mark, transparent · for light backgrounds',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-light-mode',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        guides: [],
        fileNote: 'PNG with alpha',
        source: { label: 'Darkgrade brand', url: 'https://darkgrade.com' },
        notes: ['Black mark on transparent, matching darkgrade_icon_light.svg. Use it on light surfaces.'],
    },
    {
        id: 'square-transparent-dark',
        tabLabel: 'Square · transparent dark',
        platform: 'Square mark, transparent · for dark backgrounds',
        width: SQUARE_SIZE,
        height: SQUARE_SIZE,
        look: 'mark-dark-mode',
        contentArea: { x: 0, y: 0, width: SQUARE_SIZE, height: SQUARE_SIZE },
        guides: [],
        fileNote: 'PNG with alpha',
        source: { label: 'Darkgrade brand', url: 'https://darkgrade.com' },
        notes: ['White mark on transparent, matching darkgrade_icon_dark.svg. Use it on dark surfaces.'],
    },
]

export function getAssetFilename(format: AssetFormat): string {
    if (format.filename) return format.filename
    return `darkgrade-${format.id}-${format.width}x${format.height}.png`
}
