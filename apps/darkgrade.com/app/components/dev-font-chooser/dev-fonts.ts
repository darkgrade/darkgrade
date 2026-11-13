/**
 * Shared by the font chooser component and the pre-paint bootstrap script, so
 * a reload applies the chosen fonts before first paint (and before the page
 * measures its text) rather than after.
 */

export type FontCategory = 'heading' | 'body' | 'mono'

export const FONT_CATEGORIES: readonly FontCategory[] = ['heading', 'body', 'mono']

export interface CategoryDefinition {
    label: string
    /** The design token (see @theme in globals.css) this category overrides. */
    cssVariable: string
    /** What the site uses today; a chosen font falls back to it while loading. */
    fallbackStack: string
}

export const CATEGORY_DEFINITIONS: Record<FontCategory, CategoryDefinition> = {
    heading: {
        label: 'Heading',
        cssVariable: '--font-serif',
        fallbackStack: 'var(--font-site-sans), system-ui, sans-serif',
    },
    body: {
        label: 'Body',
        cssVariable: '--font-sans',
        fallbackStack: 'var(--font-site-sans), system-ui, sans-serif',
    },
    mono: {
        label: 'Mono',
        cssVariable: '--font-mono',
        fallbackStack: 'var(--font-site-mono), ui-monospace, monospace',
    },
}

/** A family to audition, by its name on Google Fonts, with the weights asked of it there (the value of its `wght` axis, or nothing for a family of one weight). */
export interface DevFont {
    family: string
    weights: string
    /** The heaviest weight the family has, where that is worth showing. */
    heaviest?: number
}

/** A heading family whose weight runs continuously up to `heaviest`. */
const upTo = (heaviest: number, ...families: string[]): DevFont[] =>
    families.map(family => ({ family, weights: `500..${heaviest}`, heaviest }))

/** A heading family drawn in separate weights, 500 to 900. */
const inSteps = (...families: string[]): DevFont[] =>
    families.map(family => ({ family, weights: '500;600;700;800;900', heaviest: 900 }))

/** The second batch of heading families, chosen for how heavy they go; then the sans faces the body chooses among. */
const HEADING_FONTS: DevFont[] = [
    ...upTo(
        900,
        'Archivo',
        'Unbounded',
        'Epilogue',
        'Lexend',
        'Geologica',
        'Gabarito',
        'Golos Text',
        'Reddit Sans',
        'Hubot Sans',
        'Chivo',
        'Darker Grotesque',
        'Sofia Sans',
        'Montserrat',
        'Rubik',
        'League Spartan',
        'Kumbh Sans',
        'Zalando Sans',
        'Google Sans Flex',
        'TikTok Sans',
        'Anybody',
        'Encode Sans',
        'Afacad Flux',
        'Nunito Sans',
        'Roboto Flex'
    ),
    ...inSteps('Poppins', 'Barlow'),
    ...upTo(800, 'Syne', 'Parkinsans', 'Atkinson Hyperlegible Next'),
    { family: 'Cal Sans', weights: '' },
    ...upTo(
        900,
        'DM Sans',
        'Public Sans',
        'Inter',
        'Inter Tight',
        'Geist',
        'Figtree',
        'Hanken Grotesk',
        'Schibsted Grotesk',
        'Onest',
        'Albert Sans',
        'Outfit',
        'Work Sans',
        'Red Hat Display',
        'Urbanist',
        'Mona Sans',
        'SUSE'
    ),
    ...inSteps('Be Vietnam Pro'),
    ...upTo(
        800,
        'Manrope',
        'Plus Jakarta Sans',
        'Sora',
        'Bricolage Grotesque',
        'Host Grotesk',
        'Funnel Display',
        'Funnel Sans',
        'Rethink Sans',
        'Wix Madefor Display'
    ),
    ...upTo(700, 'Instrument Sans', 'IBM Plex Sans', 'Space Grotesk', 'Familjen Grotesk'),
]

/** Clean sans faces in the neighbourhood of Instrument Sans, DM Sans and Public Sans, for running text. */
const BODY_FONTS: DevFont[] = [
    'Public Sans',
    'Instrument Sans',
    'DM Sans',
    'Inter',
    'Inter Tight',
    'Geist',
    'Manrope',
    'Plus Jakarta Sans',
    'Figtree',
    'Hanken Grotesk',
    'Schibsted Grotesk',
    'Onest',
    'Albert Sans',
    'Be Vietnam Pro',
    'Outfit',
    'Sora',
    'Work Sans',
    'IBM Plex Sans',
    'Bricolage Grotesque',
    'Space Grotesk',
    'Host Grotesk',
    'Funnel Display',
    'Funnel Sans',
    'Rethink Sans',
    'Red Hat Display',
    'Urbanist',
    'Mona Sans',
    'Familjen Grotesk',
    'SUSE',
    'Wix Madefor Display',
].map(family => ({ family, weights: '400;500;600;700' }))

const MONO_FONTS: DevFont[] = [
    { family: 'Fragment Mono', weights: '' },
    { family: 'Geist Mono', weights: '400;500' },
    { family: 'DM Mono', weights: '400;500' },
    { family: 'JetBrains Mono', weights: '400;500' },
    { family: 'IBM Plex Mono', weights: '400;500' },
    { family: 'Martian Mono', weights: '400;500' },
    { family: 'Spline Sans Mono', weights: '400;500' },
    { family: 'Red Hat Mono', weights: '400;500' },
    { family: 'Sometype Mono', weights: '400;500' },
    { family: 'Azeret Mono', weights: '400;500' },
    { family: 'Reddit Mono', weights: '400;500' },
    { family: 'Roboto Mono', weights: '400;500' },
    { family: 'Google Sans Code', weights: '400;500' },
    { family: 'Space Mono', weights: '400;700' },
]

/** The families each category chooses among. */
export const FONTS_BY_CATEGORY: Record<FontCategory, readonly DevFont[]> = {
    heading: HEADING_FONTS,
    body: BODY_FONTS,
    mono: MONO_FONTS,
}

/** The weights to ask Google Fonts for, by category and family: handed to `applyDevFonts`, which may reference nothing outside itself. */
export const WEIGHTS_BY_CATEGORY: Record<string, Record<string, string>> = Object.fromEntries(
    FONT_CATEGORIES.map(category => [
        category,
        Object.fromEntries(FONTS_BY_CATEGORY[category].map(font => [font.family, font.weights])),
    ])
)

/** The weights a heading may be tried at, lightest to heaviest. */
export const HEADING_WEIGHTS: readonly number[] = [500, 600, 700, 800, 900]
/** The custom property every heading takes its weight from (see globals.css). */
export const HEADING_WEIGHT_VARIABLE = '--heading-weight'

export const STORAGE_KEY = 'darkgrade:dev-font-chooser:v3'
export const STYLE_ELEMENT_ID = 'dev-font-chooser-faces'

export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]']

/** The family chosen for each category, or null for the site's own. */
export type SelectedFonts = Record<FontCategory, string | null>

/**
 * Loads each selected family from Google Fonts and points its category's design
 * token at it, and sets the weight of headings when one has been chosen. It is
 * serialised into the bootstrap script below, so it must stay self-contained: no
 * references to anything outside its own body.
 */
export function applyDevFonts(
    selected: SelectedFonts,
    headingWeight: number | null,
    definitions: Record<string, CategoryDefinition>,
    weightsByCategory: Record<string, Record<string, string>>,
    headingWeightVariable: string,
    styleElementId: string
): void {
    let imports = ''
    for (const category of Object.keys(definitions)) {
        const definition = definitions[category]
        const family = (selected as Record<string, string | null>)[category]
        const weights = family ? weightsByCategory[category][family] : undefined
        if (!family || weights === undefined) {
            document.documentElement.style.removeProperty(definition.cssVariable)
            continue
        }
        const query = family.split(' ').join('+') + (weights ? ':wght@' + weights : '')
        imports += '@import url("https://fonts.googleapis.com/css2?family=' + query + '&display=swap");'
        document.documentElement.style.setProperty(
            definition.cssVariable,
            JSON.stringify(family) + ',' + definition.fallbackStack
        )
    }
    if (headingWeight) document.documentElement.style.setProperty(headingWeightVariable, String(headingWeight))
    else document.documentElement.style.removeProperty(headingWeightVariable)

    let styleElement = document.getElementById(styleElementId)
    if (!styleElement) {
        styleElement = document.createElement('style')
        styleElement.id = styleElementId
        document.head.appendChild(styleElement)
    }
    styleElement.textContent = imports
}

/** Inline <head> script: re-applies the persisted selection before first paint. */
export const DEV_FONT_BOOTSTRAP_SCRIPT = `(function () {
    try {
        var loopback = ${JSON.stringify(LOOPBACK_HOSTNAMES)};
        if (loopback.indexOf(location.hostname) === -1) return;
        var stored = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || 'null');
        if (!stored || !stored.selected) return;
        (${applyDevFonts.toString()})(
            stored.selected,
            stored.headingWeight || null,
            ${JSON.stringify(CATEGORY_DEFINITIONS)},
            ${JSON.stringify(WEIGHTS_BY_CATEGORY)},
            ${JSON.stringify(HEADING_WEIGHT_VARIABLE)},
            ${JSON.stringify(STYLE_ELEMENT_ID)}
        );
    } catch (error) {}
})();`
